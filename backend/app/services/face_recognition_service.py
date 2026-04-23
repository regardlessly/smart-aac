"""Bridge to the embedded face_recognizer module.

FaceRecognizer manages its own camera threads, batch analysis,
auto-learning, cross-batch re-identification, and session tracking.

This service is a singleton that:
  - Builds camera configs from the smart-aac database
  - Translates on_person_detected callbacks into domain operations
    (PresenceService, AlertService, SSE)
  - Runs a periodic snapshot loop for the dashboard camera grid
"""

import os
import logging
import threading
import time
import base64
import traceback

logger = logging.getLogger('face_recognition_service')
logger.setLevel(logging.DEBUG)
_frs_handler = logging.StreamHandler()
_frs_handler.setFormatter(logging.Formatter('[face_recognition_service] %(message)s'))
if not logger.handlers:
    logger.addHandler(_frs_handler)

# Patch InsightFace's makedirs bug (doesn't use exist_ok=True)
_original_makedirs = os.makedirs


def _makedirs_exist_ok(name, mode=0o777, exist_ok=False):
    return _original_makedirs(name, mode=mode, exist_ok=True)


os.makedirs = _makedirs_exist_ok

# Default data directory (within smart-aac project)
_DEFAULT_DATA_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '..', '..', '..', 'data')
)


class FaceRecognitionService:
    """Singleton wrapper around FaceRecognizer.

    Manages the lifecycle of the face recognition system and bridges
    detection events to smart-aac's domain services.
    """

    _instance = None          # FaceRecognizer instance
    _app = None               # Flask app reference (for app_context)
    _running = False
    _lock = threading.Lock()
    _camera_id_map = {}       # camera name -> Camera.id
    _snapshot_thread_ref = None
    _data_dir = None
    # Per-camera face data from latest snapshot analysis.
    # {camera_name: {'identified': [name, ...],
    #                'stranger_embeddings': [np.array, ...],
    #                'person_count': int}}
    _camera_face_data = {}
    # Enrollment state
    _enrollment_active = False
    _enrollment_camera = None
    _enrollment_person = None
    _enrollment_cancel = False
    _enrollment_captured = 0
    _enrollment_thread = None
    # Manual enrollment session — persistent RTSP + collected crops
    _manual_enroll_cap = None
    _manual_enroll_crops = []
    _manual_reader_thread = None
    _manual_reader_stop = False
    _manual_latest_frame = None
    _manual_frame_lock = threading.Lock()  # list of {'crop': np.array, 'embedding': np.array, 'det_score': float, 'crop_b64': str}

    # ── Lifecycle ─────────────────────────────────────────────────

    @classmethod
    def start(cls, app):
        """Build camera list from DB, instantiate FaceRecognizer, start it."""
        with cls._lock:
            if cls._running:
                logger.warning('Already running')
                return

            cls._app = app
            cls._data_dir = app.config.get('FACE_DATA_DIR', _DEFAULT_DATA_DIR)

        # Everything below needs app context for DB access
        with app.app_context():
            from ..models.camera import Camera
            from ..lib.face_recognizer import FaceRecognizer

            # Build camera config from database
            db_cameras = Camera.query.filter_by(enabled=True).all()
            cameras = []
            camera_id_map = {}
            for cam in db_cameras:
                if not cam.rtsp_url:
                    continue
                cameras.append({
                    'name': cam.name,
                    'url': cam.rtsp_url,
                })
                camera_id_map[cam.name] = cam.id

            if not cameras:
                logger.warning('No enabled cameras with RTSP URLs — '
                               'starting in status-only mode')
                with cls._lock:
                    cls._camera_id_map = {}
                    cls._running = False
                return

            data_dir = cls._data_dir or _DEFAULT_DATA_DIR
            known_faces_dir = os.path.join(data_dir, 'known_faces')
            os.makedirs(known_faces_dir, exist_ok=True)
            model_path = os.path.join(data_dir, 'models', 'yolov8n.pt')

            with cls._lock:
                cls._camera_id_map = camera_id_map

                cls._instance = FaceRecognizer(
                    cameras=cameras,
                    known_faces=known_faces_dir,
                    models={'yolo': model_path},
                    on_person_detected=cls._on_detection,
                    confidence_threshold=0.40,
                    capture_interval=app.config.get(
                        'FR_CAPTURE_INTERVAL', 5),
                    analyse_every=app.config.get(
                        'FR_ANALYSE_EVERY', 5),
                    det_size=(640, 640),
                    output_dir=os.path.join(data_dir, 'output'),
                    auto_learn=True,  # Only learns KNOWN people (strangers excluded)
                    save_captures=False,
                )
                cls._instance.start()
                cls._running = True

            # Start periodic snapshot thread for the dashboard grid
            cls._snapshot_thread_ref = threading.Thread(
                target=cls._snapshot_loop, daemon=True,
                name='snapshot-loop')
            cls._snapshot_thread_ref.start()

            logger.info('FaceRecognizer started with %d camera(s)',
                        len(cameras))

    @classmethod
    def stop(cls):
        """Stop the FaceRecognizer, return summary."""
        with cls._lock:
            if not cls._running or cls._instance is None:
                return None
            cls._running = False

        try:
            summary = cls._instance.stop()
        except Exception:
            logger.error('Error stopping FaceRecognizer:\n'
                         + traceback.format_exc())
            summary = None

        with cls._lock:
            cls._instance = None

        logger.info('FaceRecognizer stopped')
        return summary

    @classmethod
    def get_status(cls):
        """Return FaceRecognizer session status."""
        with cls._lock:
            if cls._instance is None:
                return {'status': 'stopped'}
            try:
                return cls._instance.get_status()
            except Exception:
                return {'status': 'error'}

    # ── Known face management ─────────────────────────────────────

    @classmethod
    def add_known_face(cls, name, image_path):
        """Add a known face image. Hot-reloads if running."""
        with cls._lock:
            if cls._instance:
                cls._instance.add_known_face(name, image_path)
                logger.info('Added known face: %s', name)

    @classmethod
    def remove_known_face(cls, name):
        """Remove all known face images for a person. Hot-reloads."""
        with cls._lock:
            if cls._instance:
                cls._instance.remove_known_face(name)
                logger.info('Removed known face: %s', name)

    @classmethod
    def reload_known_faces(cls):
        """Reload known face embeddings from disk (batch operation)."""
        with cls._lock:
            if cls._instance and cls._instance._engine is not None:
                cls._instance._engine._load_known_faces()
                logger.info('Reloaded known faces: %d embeddings',
                            len(cls._instance._engine.known_embeddings))

    # ── Cross-camera room occupancy ─────────────────────────────

    @classmethod
    def get_room_occupancy(cls, room_camera_names, similarity_threshold=0.45):
        """Compute deduplicated person count for a room across cameras.

        Uses face embeddings to match the same stranger across cameras.

        Args:
            room_camera_names: list of camera names assigned to this room
            similarity_threshold: cosine similarity to consider same person

        Returns:
            dict with 'identified', 'strangers', 'total', 'person_count_max'
        """
        import numpy as np

        all_identified = set()
        all_stranger_embeddings = []  # (camera_name, embedding)
        max_person_count = 0

        for cam_name in room_camera_names:
            data = cls._camera_face_data.get(cam_name)
            if not data:
                continue
            all_identified.update(data['identified'])
            for emb in data['stranger_embeddings']:
                all_stranger_embeddings.append((cam_name, emb))
            max_person_count = max(max_person_count, data['person_count'])

        # Cluster stranger embeddings across cameras
        # Greedy: assign each embedding to an existing cluster or create new
        clusters = []  # list of representative embeddings
        for cam_name, emb in all_stranger_embeddings:
            matched = False
            for i, rep in enumerate(clusters):
                sim = float(np.dot(rep, emb))
                if sim >= similarity_threshold:
                    # Same person — update representative with average
                    clusters[i] = (rep + emb)
                    clusters[i] = clusters[i] / np.linalg.norm(clusters[i])
                    matched = True
                    break
            if not matched:
                clusters.append(emb.copy())

        unique_strangers = len(clusters)
        identified_count = len(all_identified)
        total = identified_count + unique_strangers

        return {
            'identified': identified_count,
            'identified_names': list(all_identified),
            'strangers': unique_strangers,
            'total': total,
            'person_count_max': max_person_count,
        }

    # ── CCTV Face Enrollment ────────────────────────────────────

    @classmethod
    def start_enrollment(cls, camera_name, person_name, rtsp_url,
                         duration=15):
        """Start a face enrollment session in a background thread."""
        if cls._enrollment_active:
            return {'error': 'Enrollment already in progress'}
        if not cls._running or cls._instance is None:
            return {'error': 'Face recognition system not running'}

        cls._enrollment_active = True
        cls._enrollment_camera = camera_name
        cls._enrollment_person = person_name
        cls._enrollment_cancel = False
        cls._enrollment_captured = 0

        cls._enrollment_thread = threading.Thread(
            target=cls._enrollment_loop,
            args=(camera_name, person_name, rtsp_url, duration),
            daemon=True, name='enrollment')
        cls._enrollment_thread.start()
        return {'status': 'started'}

    @classmethod
    def cancel_enrollment(cls):
        """Cancel an active enrollment session."""
        cls._enrollment_cancel = True
        # Also release manual enrollment if active
        if cls._manual_enroll_cap is not None:
            try: cls._manual_enroll_cap.release()
            except Exception: pass
            cls._manual_enroll_cap = None
        cls._manual_enroll_crops = []
        cls._enrollment_active = False
        return {'status': 'cancelled'}

    @classmethod
    def prewarm_rtsp(cls, camera_name, rtsp_url):
        """Pre-open the RTSP connection for enrollment.

        Pauses all other cameras and starts opening the RTSP so that when
        the user actually clicks Start Enrollment, the connection is ready.
        """
        # Mark active to pause other cameras immediately
        if cls._enrollment_active:
            # Reuse existing session if same camera
            if cls._enrollment_camera == camera_name and cls._manual_enroll_cap is not None:
                return {'status': 'already_warm'}
            # Different camera — cleanup first
            cls._cleanup_manual()

        cls._enrollment_active = True
        cls._enrollment_camera = camera_name
        cls._enrollment_person = None  # not set until start
        cls._enrollment_cancel = False
        cls._manual_enroll_crops = []
        with cls._manual_frame_lock:
            cls._manual_latest_frame = None

        # Spawn reader thread that opens RTSP in background
        cls._manual_reader_stop = False
        cls._manual_reader_thread = threading.Thread(
            target=cls._manual_reader_open_and_loop,
            args=(rtsp_url,),
            daemon=True, name='enrollment-prewarm')
        cls._manual_reader_thread.start()
        logger.info('[prewarm] Started RTSP prewarm for %s', camera_name)
        return {'status': 'warming'}

    @classmethod
    def start_manual_enrollment(cls, camera_name, person_name, rtsp_url):
        """Start a manual enrollment session — returns immediately.
        Reuses a pre-warmed RTSP connection if one exists."""
        if not cls._running or cls._instance is None:
            return {'error': 'Face recognition system not running'}

        # Check if we have a pre-warmed session for this camera
        if (cls._enrollment_active
                and cls._enrollment_camera == camera_name
                and cls._manual_reader_thread is not None
                and cls._manual_reader_thread.is_alive()):
            # Reuse existing prewarmed session
            cls._enrollment_person = person_name
            cls._manual_enroll_crops = []
            logger.info('[manual-enroll] Reusing prewarmed session for %s on %s',
                        person_name, camera_name)
            return {'status': 'started'}

        # No pre-warm — do full cleanup and restart
        if cls._enrollment_active:
            logger.info('[manual-enroll] Cleaning up leftover session')
            cls._cleanup_manual()

        cls._enrollment_camera = camera_name
        cls._enrollment_person = person_name
        cls._enrollment_cancel = False
        cls._manual_enroll_crops = []
        with cls._manual_frame_lock:
            cls._manual_latest_frame = None
        cls._enrollment_active = True

        cls._manual_reader_stop = False
        cls._manual_reader_thread = threading.Thread(
            target=cls._manual_reader_open_and_loop,
            args=(rtsp_url,),
            daemon=True, name='enrollment-reader')
        cls._manual_reader_thread.start()

        logger.info('[manual-enroll] Session starting for %s on %s '
                    '(reader thread spawned)', person_name, camera_name)
        return {'status': 'started'}

    @classmethod
    def _manual_reader_open_and_loop(cls, rtsp_url):
        """Background: open RTSP + continuously read frames, keep latest."""
        import cv2
        open_start = time.time()
        logger.info('[manual-reader] Opening RTSP...')
        try:
            cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
            try: cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            except Exception: pass
            if not cap.isOpened():
                logger.error('[manual-reader] Failed to open RTSP')
                cls._enrollment_active = False
                return
            cls._manual_enroll_cap = cap
            logger.info('[manual-reader] RTSP opened in %.1fs, starting read loop',
                        time.time() - open_start)
            try:
                from ..api.sse import push_event as _push
                _push({'type': 'enrollment_ready'})
            except Exception:
                pass
        except Exception as e:
            logger.error('[manual-reader] Open error: %s', e)
            cls._enrollment_active = False
            return

        # Continuous read loop
        import cv2 as _cv2
        import base64 as _b64
        from ..api.sse import push_event

        frame_count = 0
        last_sse_push = 0.0
        SSE_INTERVAL = 0.4

        while not cls._manual_reader_stop and cls._manual_enroll_cap is not None:
            try:
                ret, frame = cls._manual_enroll_cap.read()
                if ret and frame is not None:
                    with cls._manual_frame_lock:
                        cls._manual_latest_frame = frame
                    frame_count += 1
                    try:
                        with cls._instance._latest_frames_lock:
                            cls._instance._latest_frames[
                                cls._enrollment_camera] = frame.copy()
                    except Exception:
                        pass

                    now = time.time()
                    if now - last_sse_push >= SSE_INTERVAL:
                        last_sse_push = now
                        try:
                            h, w = frame.shape[:2]
                            if w > 640:
                                scale = 640 / w
                                preview = _cv2.resize(frame,
                                    (int(w*scale), int(h*scale)))
                            else:
                                preview = frame
                            _, buf = _cv2.imencode('.jpg', preview,
                                [_cv2.IMWRITE_JPEG_QUALITY, 65])
                            b64 = _b64.b64encode(buf).decode('ascii')
                            push_event({
                                'type': 'enrollment_live_frame',
                                'frame_b64': b64,
                            })
                        except Exception:
                            pass
                else:
                    time.sleep(0.1)
            except Exception as e:
                logger.warning('[manual-reader] Read error: %s', e)
                time.sleep(0.2)
        logger.info('[manual-reader] Stopped (%d frames read)', frame_count)

    @classmethod
    def manual_capture_one(cls):
        """Capture one frame from the active manual enrollment session.

        Returns the face crop as base64 plus metadata.
        """
        import cv2
        import base64 as _b64

        logger.info('[manual-capture] Called: active=%s cap=%s',
                    cls._enrollment_active, cls._manual_enroll_cap is not None)

        if not cls._enrollment_active:
            return {'error': 'No active enrollment session'}
        if cls._manual_enroll_cap is None:
            return {'error': 'Camera connecting... try again in 2 seconds'}

        engine = None
        with cls._lock:
            if cls._instance:
                engine = cls._instance._engine
        if not engine:
            return {'error': 'Face engine not ready'}

        # Read the latest frame from the background reader (always fresh)
        with cls._manual_frame_lock:
            frame = None if cls._manual_latest_frame is None else cls._manual_latest_frame.copy()
        if frame is None:
            logger.warning('[manual-capture] No frame available yet')
            return {'error': 'No frame available yet — wait a moment'}
        logger.info('[manual-capture] Got frame %dx%d (from background reader)',
                    frame.shape[1], frame.shape[0])

        # Publish frame to live preview
        try:
            with cls._instance._latest_frames_lock:
                cls._instance._latest_frames[cls._enrollment_camera] = frame.copy()
        except Exception:
            pass

        face_results = engine.analyze_frame(frame)
        faces = [r for r in face_results if r.get('embedding') is not None]
        logger.info('[manual-capture] Detected %d faces', len(faces))

        if len(faces) == 0:
            return {'error': 'No face detected — turn towards camera'}
        if len(faces) > 1:
            return {'error': f'{len(faces)} faces detected — only 1 person should be visible'}

        face = faces[0]
        embedding = face['embedding']

        # Reject if too similar to an already-captured pose
        import numpy as _np
        DIVERSITY_THRESHOLD = 0.93
        for existing in cls._manual_enroll_crops:
            sim = float(_np.dot(embedding, existing['embedding']))
            if sim > DIVERSITY_THRESHOLD:
                logger.info('[manual-capture] Rejected duplicate pose (sim=%.3f)', sim)
                return {'error': f'Too similar to previous capture (sim={sim:.2f}). Turn your head to a new angle.'}

        x, y, w, h = face['x'], face['y'], face['w'], face['h']
        # Use larger padding (60%) so the crop has enough context
        # for SCRFD to re-detect the face when loading embeddings
        pad = int(max(w, h) * 0.6)
        fh, fw = frame.shape[:2]
        x1 = max(0, x - pad)
        y1 = max(0, y - pad)
        x2 = min(fw, x + w + pad)
        y2 = min(fh, y + h + pad)
        crop = frame[y1:y2, x1:x2]

        # Verify SCRFD can re-detect the face in the crop (using the
        # loader instance at 640x640 — same as _load_known_faces does)
        try:
            loader = engine._loader_app if hasattr(engine, '_loader_app') else None
            if loader is not None:
                verify_faces = loader.get(crop)
                if not verify_faces:
                    logger.info('[manual-capture] Crop rejected: face not re-detectable')
                    return {'error': 'Face too small/angled — get closer to camera and face it directly'}
        except Exception:
            pass

        _, buf = cv2.imencode('.jpg', crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
        crop_b64 = _b64.b64encode(buf).decode('ascii')

        cls._manual_enroll_crops.append({
            'crop': crop,
            'embedding': face['embedding'],
            'det_score': face.get('det_score', 0),
            'crop_b64': crop_b64,
        })

        return {
            'status': 'ok',
            'captured': len(cls._manual_enroll_crops),
            'quality': round(face.get('det_score', 0), 3),
            'face_crop_b64': crop_b64,
        }

    @classmethod
    def finish_manual_enrollment(cls, keep_indices=None):
        """Save collected crops to known_faces/, reload engine, close session.

        keep_indices: optional list of indices to save. If None, saves all.
        """
        import cv2 as _cv2

        if not cls._enrollment_active:
            return {'error': 'No active enrollment session'}

        crops = cls._manual_enroll_crops
        if keep_indices is not None:
            crops = [crops[i] for i in keep_indices if 0 <= i < len(crops)]

        if len(crops) < 1:
            cls._cleanup_manual()
            return {'error': 'No crops to save'}

        person_name = cls._enrollment_person
        data_dir = cls._data_dir or os.path.abspath(
            os.path.join(os.path.dirname(__file__), '..', '..', 'data'))
        known_dir = os.path.join(data_dir, 'known_faces')
        os.makedirs(known_dir, exist_ok=True)

        safe_name = person_name.replace(' ', '_')
        existing = [f for f in os.listdir(known_dir)
                    if f.lower().startswith(safe_name.lower())
                    and f.lower().endswith(('.jpg', '.jpeg', '.png'))]
        next_num = len(existing) + 1

        saved = 0
        for crop_data in crops:
            if next_num == 1 and not existing:
                filename = f'{safe_name}.jpg'
            else:
                filename = f'{safe_name}_{next_num}.jpg'
            dest = os.path.join(known_dir, filename)
            _cv2.imwrite(dest, crop_data['crop'])
            next_num += 1
            saved += 1

        # Reload face engine once
        new_count = 0
        try:
            with cls._lock:
                if cls._instance and cls._instance._engine:
                    cls._instance._engine._load_known_faces()
                    new_count = len(cls._instance._engine.known_embeddings)
        except Exception:
            pass

        cls._cleanup_manual()
        logger.info('[manual-enroll] Saved %d crops for %s — %d embeddings total',
                    saved, person_name, new_count)
        return {
            'status': 'ok',
            'person': person_name,
            'saved': saved,
            'embeddings': new_count,
        }

    @classmethod
    def _cleanup_manual(cls):
        """Release manual enrollment session resources."""
        # Signal reader thread to stop
        cls._manual_reader_stop = True
        if cls._manual_reader_thread is not None:
            try:
                cls._manual_reader_thread.join(timeout=2)
            except Exception:
                pass
            cls._manual_reader_thread = None

        if cls._manual_enroll_cap is not None:
            try: cls._manual_enroll_cap.release()
            except Exception: pass
            cls._manual_enroll_cap = None

        with cls._manual_frame_lock:
            cls._manual_latest_frame = None
        cls._manual_enroll_crops = []
        cls._enrollment_active = False
        cls._enrollment_camera = None
        cls._enrollment_person = None

    @classmethod
    def get_enrollment_status(cls):
        """Return current enrollment state."""
        return {
            'active': cls._enrollment_active,
            'camera_name': cls._enrollment_camera,
            'person_name': cls._enrollment_person,
            'captured': cls._enrollment_captured,
            'ready': cls._manual_enroll_cap is not None,
        }

    @classmethod
    def _enrollment_loop(cls, camera_name, person_name, rtsp_url,
                         duration):
        """Background: capture frames, extract face crops, save best ones."""
        import cv2
        import numpy as np

        from ..api.sse import push_event

        logger.info('[enrollment] Starting: camera=%s person=%s duration=%ds',
                    camera_name, person_name, duration)

        push_event({
            'type': 'enrollment_started',
            'camera': camera_name,
            'person': person_name,
            'duration': duration,
        })

        captured_crops = []  # list of (frame_crop, embedding, det_score)
        total_target = 10
        capture_interval = 1.0  # poll every 1s for fresh frames
        max_duration = duration * 2  # allow up to 2x duration to get frames
        start_time = time.time()

        cap = None
        try:
            engine = None
            with cls._lock:
                if cls._instance:
                    engine = cls._instance._engine

            if not engine:
                push_event({'type': 'enrollment_error',
                            'message': 'Face engine not ready'})
                cls._enrollment_active = False
                return

            # Wait 3s for camera threads to notice pause + release RTSP
            logger.info('[enrollment] Waiting for camera threads to pause...')
            time.sleep(3)

            # Open dedicated RTSP connection
            logger.info('[enrollment] Opening enrollment RTSP...')
            cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
            if not cap.isOpened():
                push_event({'type': 'enrollment_error',
                            'message': f'Cannot connect to {camera_name}'})
                cls._enrollment_active = False
                return
            logger.info('[enrollment] RTSP opened')

            # Reset start_time AFTER RTSP is ready (RTSP open can be slow)
            start_time = time.time()
            iter_num = 0
            while len(captured_crops) < total_target:
                if cls._enrollment_cancel:
                    push_event({'type': 'enrollment_cancelled'})
                    break
                if time.time() - start_time > max_duration:
                    logger.info('[enrollment] Max duration reached')
                    break

                iter_num += 1
                logger.info('[enrollment] Iteration %d — captured so far: %d',
                            iter_num, len(captured_crops))

                # Grab latest frame directly from RTSP (skip buffered frames)
                for _ in range(5):
                    cap.grab()
                ret, frame = cap.read()
                if not ret or frame is None:
                    logger.warning('[enrollment] No frame from RTSP')
                    time.sleep(capture_interval)
                    continue

                # Also publish to camera's latest_frames so snapshot loop + modal can see it
                try:
                    with cls._instance._latest_frames_lock:
                        cls._instance._latest_frames[camera_name] = frame.copy()
                except Exception:
                    pass

                logger.info('[enrollment] Got frame %dx%d', frame.shape[1], frame.shape[0])

                # Analyse frame
                try:
                    face_results = engine.analyze_frame(frame)
                    logger.info('[enrollment] analyze_frame returned %d faces',
                                len(face_results))
                except Exception as e:
                    logger.warning('[enrollment] analyze error: %s', e)
                    time.sleep(capture_interval)
                    continue

                # Filter: only faces (not Stranger-named auto-learns)
                faces = [r for r in face_results
                         if r.get('embedding') is not None]

                if len(faces) == 0:
                    push_event({
                        'type': 'enrollment_progress',
                        'captured': len(captured_crops),
                        'total_target': total_target,
                        'message': 'No face detected — turn towards camera',
                    })
                    time.sleep(capture_interval)
                    continue

                if len(faces) > 1:
                    push_event({
                        'type': 'enrollment_progress',
                        'captured': len(captured_crops),
                        'total_target': total_target,
                        'message': f'{len(faces)} faces — only 1 person should be visible',
                    })
                    time.sleep(capture_interval)
                    continue

                face = faces[0]
                det_score = face.get('det_score', 0)
                embedding = face['embedding']
                yaw = face.get('yaw', 0.0)

                # Enforce minimum time gap between captures (1 second)
                # This ensures faces span natural movement over time
                if captured_crops:
                    last_ts = captured_crops[-1].get('ts', 0)
                    if time.time() - last_ts < 1.0:
                        time.sleep(0.3)
                        continue

                # Extract face crop from frame
                x, y, w, h = face['x'], face['y'], face['w'], face['h']
                pad = int(max(w, h) * 0.3)
                fh, fw = frame.shape[:2]
                x1 = max(0, x - pad)
                y1 = max(0, y - pad)
                x2 = min(fw, x + w + pad)
                y2 = min(fh, y + h + pad)
                crop = frame[y1:y2, x1:x2]

                # Encode crop as base64 for SSE preview
                _, buf = cv2.imencode('.jpg', crop,
                                      [cv2.IMWRITE_JPEG_QUALITY, 85])
                crop_b64 = base64.b64encode(buf).decode('ascii')

                captured_crops.append({
                    'crop': crop,
                    'embedding': embedding,
                    'det_score': det_score,
                    'crop_b64': crop_b64,
                    'yaw': yaw,
                    'ts': time.time(),
                })
                cls._enrollment_captured = len(captured_crops)
                logger.info('[enrollment] Captured unique face #%d (quality=%.2f, yaw=%+.2f)',
                            len(captured_crops), det_score, yaw)

                push_event({
                    'type': 'enrollment_progress',
                    'captured': len(captured_crops),
                    'total_target': total_target,
                    'quality': round(det_score, 3),
                    'face_crop_b64': crop_b64,
                })

                time.sleep(capture_interval)

        except Exception:
            logger.error('[enrollment] Unexpected error:\n' + traceback.format_exc())
            push_event({'type': 'enrollment_error',
                        'message': 'Enrollment failed unexpectedly'})
            if cap is not None:
                try: cap.release()
                except Exception: pass
            cls._enrollment_active = False
            return
        finally:
            if cap is not None:
                try: cap.release()
                except Exception: pass

        if cls._enrollment_cancel:
            cls._enrollment_active = False
            return

        logger.info('[enrollment] Capture complete: %d crops collected',
                    len(captured_crops))

        # ── Select best crops by quality + diversity ──
        if len(captured_crops) < 3:
            logger.warning('[enrollment] Not enough faces: %d',
                           len(captured_crops))
            push_event({
                'type': 'enrollment_error',
                'message': f'Only {len(captured_crops)} faces captured — need at least 3. Try again with face visible to camera.',
            })
            cls._enrollment_active = False
            return

        # Filter by minimum quality
        good_crops = [c for c in captured_crops if c['det_score'] >= 0.5]
        if len(good_crops) < 3:
            good_crops = sorted(captured_crops,
                                key=lambda c: c['det_score'],
                                reverse=True)[:max(3, len(captured_crops))]

        # Greedy diversity selection
        import numpy as _np
        selected = [good_crops[0]]  # best quality first
        remaining = good_crops[1:]

        max_select = min(8, len(good_crops))
        while len(selected) < max_select and remaining:
            best_idx = -1
            best_diversity = -1
            for idx, cand in enumerate(remaining):
                # Min similarity to any already-selected crop
                min_sim = min(
                    float(_np.dot(cand['embedding'], s['embedding']))
                    for s in selected)
                diversity = 1.0 - min_sim
                if diversity > best_diversity:
                    best_diversity = diversity
                    best_idx = idx
            if best_idx >= 0:
                selected.append(remaining.pop(best_idx))
            else:
                break

        # ── Save selected crops to known_faces/ ──
        data_dir = cls._data_dir or os.path.abspath(
            os.path.join(os.path.dirname(__file__), '..', '..', 'data'))
        known_dir = os.path.join(data_dir, 'known_faces')
        os.makedirs(known_dir, exist_ok=True)

        safe_name = person_name.replace(' ', '_')
        # Count existing files for this person
        existing = [f for f in os.listdir(known_dir)
                    if f.lower().startswith(safe_name.lower())
                    and f.lower().endswith(('.jpg', '.jpeg', '.png'))]
        next_num = len(existing) + 1

        saved = 0
        for crop_data in selected:
            if next_num == 1 and not existing:
                filename = f'{safe_name}.jpg'
            else:
                filename = f'{safe_name}_{next_num}.jpg'
            dest = os.path.join(known_dir, filename)
            import cv2 as _cv2
            _cv2.imwrite(dest, crop_data['crop'])
            next_num += 1
            saved += 1

        # Reload face engine once
        try:
            with cls._lock:
                if cls._instance and cls._instance._engine:
                    cls._instance._engine._load_known_faces()
                    new_count = len(cls._instance._engine.known_embeddings)
        except Exception:
            new_count = 0

        push_event({
            'type': 'enrollment_complete',
            'person': person_name,
            'saved': saved,
            'total_captured': len(captured_crops),
            'embeddings': new_count,
        })

        logger.info('Enrollment complete: %s — %d/%d crops saved, '
                     '%d embeddings total',
                     person_name, saved, len(captured_crops), new_count)

        cls._enrollment_active = False

    # ── Detection callback ────────────────────────────────────────

    @classmethod
    def _on_detection(cls, event):
        """Callback fired by FaceRecognizer per detection.

        event = {
            "person":     "Alice" or "Unknown_1",
            "type":       "known" or "unknown",
            "camera":     "Camera 1",
            "timestamp":  "2026-02-27T10:05:00",
            "confidence": 0.82,
            "crop":       "base64_png..." or None,
        }
        """
        if cls._app is None:
            return

        try:
            with cls._app.app_context():
                from ..models.camera import Camera
                from ..extensions import db
                from .presence_service import PresenceService
                from .alert_service import AlertService
                from ..api.sse import push_event

                camera_name = event.get('camera', '')
                camera_id = cls._camera_id_map.get(camera_name)
                if camera_id is None:
                    return

                camera = db.session.get(Camera, camera_id)
                if camera is None:
                    return

                # Translate to face_results format for PresenceService
                is_known = event['type'] == 'known'
                face_result = {
                    'name': event['person'] if is_known else 'Stranger',
                    'score': event.get('confidence', 0),
                }

                # Update presence
                PresenceService.update_from_face_results(
                    [face_result], camera, db.session)

                # Alert for unknowns (if enabled in settings)
                if not is_known:
                    from ..models.app_config import AppConfig
                    if AppConfig.get('alert_unidentified', 'true') == 'true':
                        AlertService.create_stranger_alert(
                            camera, 1, db.session)

                db.session.commit()

                # Push SSE event
                push_event({
                    'type': 'detection',
                    'camera_id': camera_id,
                    'camera_name': camera_name,
                    'person': event.get('person', ''),
                    'person_type': event.get('type', ''),
                    'confidence': event.get('confidence', 0),
                    'timestamp': event.get('timestamp', ''),
                    'crop': event.get('crop'),
                })

        except Exception:
            logger.error('Error processing detection:\n'
                         + traceback.format_exc())

    # ── Periodic snapshot loop ────────────────────────────────────

    @classmethod
    def _snapshot_loop(cls):
        """Periodically capture annotated snapshots for the dashboard grid.

        FaceRecognizer's callbacks fire per-detection, not per-frame.
        This thread captures periodic frames to keep the CCTVGrid fresh.
        """
        logger.info('Snapshot loop starting (waiting 10s for engine)...')
        # Wait for the engine to be ready
        time.sleep(10)
        logger.info('Snapshot loop active — cameras: %s',
                    list(cls._camera_id_map.keys()))

        # Track when we last ran DB cleanup (purge snapshots older than 3 days)
        last_cleanup = 0  # epoch seconds
        CLEANUP_INTERVAL = 3600  # once per hour
        RETENTION_DAYS = 3

        from ..lib.face_recognizer import annotate_frame

        while cls._running:
            try:
                with cls._app.app_context():
                    from ..models.camera import Camera, CCTVSnapshot
                    from ..extensions import db
                    from ..api.sse import push_event

                    for cam_name, cam_id in cls._camera_id_map.items():
                        if not cls._running:
                            break

                        # During enrollment, skip ALL other cameras so
                        # the NVR and CPU are dedicated to the enrolling camera
                        if (cls._enrollment_active
                                and cam_name != cls._enrollment_camera):
                            continue

                        try:
                            camera = db.session.get(Camera, cam_id)
                            if not camera or not camera.rtsp_url:
                                continue

                            # Use latest frame from FaceRecognizer's
                            # capture threads (avoids double RTSP connections)
                            frame = None
                            with cls._lock:
                                if cls._instance:
                                    frame = cls._instance.get_latest_frame(
                                        cam_name)

                            if frame is None:
                                logger.debug(
                                    'No frame available yet for %s',
                                    cam_name)
                                continue

                            # Reuse analysis results from the capture
                            # loop (avoids re-running YOLO + InsightFace)
                            cached = None
                            with cls._lock:
                                if cls._instance:
                                    cached = cls._instance.get_latest_results(
                                        cam_name)

                            if cached:
                                face_results, person_boxes = cached
                                annotated = annotate_frame(
                                    frame, face_results, cam_name,
                                    person_boxes=person_boxes)
                                # "Stranger", "Stranger_1", etc. are all
                                # unidentified — only real names count
                                def _is_known(name):
                                    return (name and
                                            name != 'Stranger' and
                                            not name.startswith('Stranger_'))
                                id_names = [
                                    r['name'] for r in face_results
                                    if _is_known(r['name'])]
                                identified = len(id_names)
                                stranger_embeddings = [
                                    r['embedding'] for r in face_results
                                    if not _is_known(r['name'])
                                    and r.get('embedding') is not None]
                                unidentified = len([
                                    r for r in face_results
                                    if not _is_known(r['name'])])
                                person_count = len(person_boxes)

                                # Store per-camera face data for
                                # cross-camera deduplication
                                import time as _time
                                cls._camera_face_data[cam_name] = {
                                    'identified': id_names,
                                    'stranger_embeddings':
                                        stranger_embeddings,
                                    'person_count': person_count,
                                    'ts': _time.time(),
                                }
                            else:
                                annotated = frame
                                identified = 0
                                unidentified = 0
                                id_names = []

                            import cv2
                            _, jpeg = cv2.imencode(
                                '.jpg', annotated,
                                [cv2.IMWRITE_JPEG_QUALITY, 70])
                            b64 = base64.b64encode(
                                jpeg).decode('ascii')

                            import json as _json
                            snapshot = CCTVSnapshot(
                                camera_id=cam_id,
                                identified_count=identified,
                                unidentified_count=unidentified,
                                identified_names=_json.dumps(
                                    id_names) if id_names else None,
                                snapshot_b64=b64,
                            )
                            db.session.add(snapshot)
                            for _retry in range(3):
                                try:
                                    db.session.commit()
                                    break
                                except Exception:
                                    db.session.rollback()
                                    time.sleep(0.5)
                            logger.debug(
                                'Snapshot saved: %s (id=%d, unk=%d)',
                                cam_name, identified, unidentified)

                            push_event({
                                'type': 'snapshot',
                                'camera_id': cam_id,
                                'camera_name': cam_name,
                                'identified': identified,
                                'unidentified': unidentified,
                            })

                        except Exception:
                            logger.error(
                                'Snapshot capture failed for %s:\n%s',
                                cam_name, traceback.format_exc())
                            try:
                                db.session.rollback()
                            except Exception:
                                pass

            except Exception:
                logger.error('Snapshot loop error:\n'
                             + traceback.format_exc())

            # Periodic cleanup: purge cctv_snapshots older than RETENTION_DAYS
            now = time.time()
            if now - last_cleanup > CLEANUP_INTERVAL:
                last_cleanup = now
                try:
                    with cls._app.app_context():
                        from ..models.camera import CCTVSnapshot
                        from ..extensions import db
                        from datetime import datetime, timedelta, timezone
                        cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
                        deleted = CCTVSnapshot.query.filter(
                            CCTVSnapshot.timestamp < cutoff
                        ).delete(synchronize_session=False)
                        db.session.commit()
                        if deleted:
                            logger.info(
                                'Retention cleanup: deleted %d snapshots older than %d days',
                                deleted, RETENTION_DAYS)
                except Exception:
                    logger.error('Retention cleanup failed:\n' + traceback.format_exc())
                    try:
                        db.session.rollback()
                    except Exception:
                        pass

            # Wait 5s between snapshot cycles, checking stop every 1s
            for _ in range(5):
                if not cls._running:
                    break
                time.sleep(1)

        logger.info('Snapshot loop stopped')
