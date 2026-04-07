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
                    confidence_threshold=0.35,
                    capture_interval=app.config.get(
                        'FR_CAPTURE_INTERVAL', 2),
                    analyse_every=app.config.get(
                        'FR_ANALYSE_EVERY', 5),
                    det_size=(640, 640),
                    output_dir=os.path.join(data_dir, 'output'),
                    auto_learn=True,
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

                            # Annotate using FaceRecognizer's engine
                            engine = None
                            with cls._lock:
                                if cls._instance:
                                    engine = cls._instance._engine

                            if engine:
                                face_results = engine.analyze_frame(
                                    frame)
                                annotated = annotate_frame(
                                    frame, face_results, cam_name,
                                    person_boxes=engine._last_persons)
                                id_names = [
                                    r['name'] for r in face_results
                                    if r['name'] != 'Stranger']
                                identified = len(id_names)
                                unidentified = len([
                                    r for r in face_results
                                    if r['name'] == 'Stranger'])
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

            # Wait 3s between snapshot cycles, checking stop every 1s
            for _ in range(3):
                if not cls._running:
                    break
                time.sleep(1)

        logger.info('Snapshot loop stopped')
