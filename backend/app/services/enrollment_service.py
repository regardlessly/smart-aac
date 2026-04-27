"""Lightweight face enrollment service.

Completely independent of the CCTV pipeline — no camera threads, no RTSP,
no YOLO. Loads InsightFace buffalo_l once (lazily) and reuses the same
loader instance that the CCTV engine uses if it is already running.

Used by the Flutter enrollment app via /api/enroll/* endpoints.
"""

import base64
import logging
import os
import threading

import cv2
import numpy as np

logger = logging.getLogger('enrollment_service')
logger.setLevel(logging.INFO)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter('[enrollment_service] %(message)s'))
    logger.addHandler(_h)


class EnrollmentService:
    """Singleton for photo-based face enrollment via device camera."""

    _lock   = threading.Lock()
    _loader = None   # insightface FaceAnalysis (loader/640 instance)

    # ── Engine ────────────────────────────────────────────────────

    @classmethod
    def _get_loader(cls):
        """Return InsightFace loader, borrowing from CCTV worker if running."""
        with cls._lock:
            if cls._loader is not None:
                return cls._loader

            # Try to borrow the already-warm loader from the CCTV worker.
            # This avoids loading the model a second time (~5 s on CPU).
            try:
                from .face_recognition_service import FaceRecognitionService
                with FaceRecognitionService._lock:
                    inst = FaceRecognitionService._instance
                    if (inst and inst._engine
                            and hasattr(inst._engine, '_loader_app')):
                        cls._loader = inst._engine._loader_app
                        logger.info('Borrowed InsightFace loader from '
                                    'running CCTV worker')
                        return cls._loader
            except Exception:
                pass

            # Load independently (CAMERA_WORKER_ENABLED=false scenario)
            logger.info('Loading InsightFace buffalo_l for enrollment '
                        '(independent, det_size=640x640)...')
            from insightface.app import FaceAnalysis
            loader = FaceAnalysis(name='buffalo_l',
                                  providers=['CPUExecutionProvider'])
            loader.prepare(ctx_id=-1, det_size=(640, 640))
            cls._loader = loader
            logger.info('InsightFace enrollment loader ready')
            return cls._loader

    # ── Core operations ───────────────────────────────────────────

    @classmethod
    def analyze_photo(cls, image_bytes):
        """Validate a JPEG photo for enrollment quality.

        Args:
            image_bytes: raw bytes of the uploaded image.

        Returns dict with either:
            {accepted, crop_b64, quality, face_w, face_h}   on success
            {error}                                          on failure
        """
        # Decode
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {'error': 'Could not decode image — ensure JPEG/PNG format'}

        loader = cls._get_loader()

        try:
            faces = loader.get(img)
        except Exception as exc:
            logger.error('InsightFace error: %s', exc)
            return {'error': f'Face analysis failed: {exc}'}

        if not faces:
            return {'error': 'No face detected — ensure face is clearly '
                             'visible and well lit'}

        if len(faces) > 1:
            return {'error': f'{len(faces)} faces detected — only one person '
                             'should be in frame'}

        face = max(faces, key=lambda f: f.det_score)

        if face.det_score < 0.50:
            return {'error': f'Detection confidence too low '
                             f'({face.det_score:.2f}) — try better lighting '
                             'or move closer'}

        bbox = face.bbox.astype(int)
        x1, y1, x2, y2 = bbox
        w, h = x2 - x1, y2 - y1

        if w < 60 or h < 60:
            return {'error': 'Face too small — hold the camera closer'}

        # Crop with generous padding so SCRFD can re-detect on reload
        pad = int(max(w, h) * 0.55)
        fh, fw = img.shape[:2]
        cx1 = max(0, x1 - pad)
        cy1 = max(0, y1 - pad)
        cx2 = min(fw, x2 + pad)
        cy2 = min(fh, y2 + pad)
        crop = img[cy1:cy2, cx1:cx2]

        if crop.size == 0:
            return {'error': 'Failed to crop face region'}

        _, buf = cv2.imencode('.jpg', crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
        crop_b64 = base64.b64encode(buf).decode('ascii')

        return {
            'accepted': True,
            'crop_b64': crop_b64,
            'quality':  round(float(face.det_score), 3),
            'face_w':   int(w),
            'face_h':   int(h),
        }

    @classmethod
    def save_enrollment(cls, person_name, crop_b64_list, data_dir):
        """Write validated face crops to known_faces/ and hot-reload.

        Args:
            person_name:    display name, e.g. "Tan Ah Kow"
            crop_b64_list:  list of base64-encoded JPEG strings
            data_dir:       root data directory (app.config['FACE_DATA_DIR'])

        Returns dict with {status, person, saved, embeddings} or {error}.
        """
        known_dir = os.path.join(data_dir, 'known_faces')
        os.makedirs(known_dir, exist_ok=True)

        safe_name = person_name.replace(' ', '_')

        # Count existing manual (non-auto) images for this person
        existing = [
            f for f in os.listdir(known_dir)
            if f.lower().startswith(safe_name.lower())
            and f.lower().endswith(('.jpg', '.jpeg', '.png'))
            and '_auto_' not in f.lower()
        ]
        next_num = len(existing) + 1

        saved = 0
        for b64_str in crop_b64_list:
            try:
                img_bytes = base64.b64decode(b64_str)
                nparr = np.frombuffer(img_bytes, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if img is None:
                    continue

                if next_num == 1 and not existing:
                    filename = f'{safe_name}_front.jpg'
                else:
                    filename = f'{safe_name}_{next_num}.jpg'

                dest = os.path.join(known_dir, filename)
                cv2.imwrite(dest, img)
                next_num += 1
                saved += 1
            except Exception as exc:
                logger.error('Failed to save crop: %s', exc)

        if saved == 0:
            return {'error': 'No images could be saved'}

        # Hot-reload the live face engine (if CCTV worker is running)
        new_count = 0
        try:
            from .face_recognition_service import FaceRecognitionService
            with FaceRecognitionService._lock:
                inst = FaceRecognitionService._instance
                if inst and inst._engine:
                    inst._engine._load_known_faces()
                    new_count = len(inst._engine.known_embeddings)
        except Exception as exc:
            logger.warning('Hot-reload skipped: %s', exc)

        logger.info('Enrolled %d image(s) for %s — %d total embeddings',
                    saved, person_name, new_count)
        return {
            'status':     'ok',
            'person':     person_name,
            'saved':      saved,
            'embeddings': new_count,
        }

    @classmethod
    def list_person_images(cls, person_name, data_dir):
        """Return list of face image metadata for a person."""
        from ..lib.face_recognizer import get_person_name

        known_dir = os.path.join(data_dir, 'known_faces')
        if not os.path.isdir(known_dir):
            return []

        results = []
        for fname in sorted(os.listdir(known_dir)):
            if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            if get_person_name(fname).lower() != person_name.lower():
                continue
            results.append({
                'filename': fname,
                'is_auto':  '_auto_' in fname.lower(),
                'mtime':    int(os.path.getmtime(
                                os.path.join(known_dir, fname))),
            })
        return results

    @classmethod
    def delete_image(cls, filename, data_dir):
        """Delete a single face image and hot-reload."""
        known_dir = os.path.join(data_dir, 'known_faces')
        path = os.path.join(known_dir, filename)

        # Path traversal guard
        if not os.path.abspath(path).startswith(
                os.path.abspath(known_dir)):
            return {'error': 'Invalid filename'}
        if not os.path.isfile(path):
            return {'error': 'File not found'}

        os.remove(path)

        try:
            from .face_recognition_service import FaceRecognitionService
            with FaceRecognitionService._lock:
                inst = FaceRecognitionService._instance
                if inst and inst._engine:
                    inst._engine._load_known_faces()
        except Exception:
            pass

        return {'status': 'ok', 'deleted': filename}
