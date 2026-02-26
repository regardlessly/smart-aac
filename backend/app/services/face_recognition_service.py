"""Bridge to the face_recognizer POC engine."""

import sys
import os

# Patch InsightFace's makedirs bug (doesn't use exist_ok=True)
_original_makedirs = os.makedirs


def _makedirs_exist_ok(name, mode=0o777, exist_ok=False):
    return _original_makedirs(name, mode=mode, exist_ok=True)


os.makedirs = _makedirs_exist_ok

# Path to the existing face_recognizer POC
FACE_RECOGNIZER_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '..', '..', '..', '..',
                 'face_recognizer')
)


class FaceRecognitionService:
    """Singleton wrapper around FaceRecognitionEngine."""

    _engine = None
    _initialized = False

    @classmethod
    def _ensure_path(cls):
        if FACE_RECOGNIZER_DIR not in sys.path:
            sys.path.insert(0, FACE_RECOGNIZER_DIR)

    @classmethod
    def get_engine(cls):
        if cls._engine is None:
            cls._ensure_path()
            from face_recognizer import FaceRecognitionEngine

            known_faces_dir = os.path.join(
                FACE_RECOGNIZER_DIR, 'known_faces')
            model_path = os.path.join(
                FACE_RECOGNIZER_DIR, 'yolov8n.pt')

            cls._engine = FaceRecognitionEngine(
                known_faces_dir=known_faces_dir,
                confidence_threshold=0.35,
                det_size=(640, 640),
                yolo_config={
                    'model_path': model_path,
                    'imgsz': 1280,
                    'person_conf': 0.30,
                    'crop_padding': 0.3,
                    'min_person_height': 80,
                },
            )
            cls._initialized = True

        return cls._engine

    @classmethod
    def capture_and_analyze(cls, rtsp_url, camera_name='Camera 1'):
        """Capture a single frame and run face recognition.

        Returns:
            (frame, face_results, annotated_frame) or (None, None, None)
        """
        cls._ensure_path()
        from face_recognizer import capture_frame, annotate_frame

        engine = cls.get_engine()
        frame = capture_frame(rtsp_url, camera_name)

        if frame is None:
            return None, None, None

        face_results = engine.analyze_frame(frame)
        annotated = annotate_frame(
            frame, face_results, camera_name,
            person_boxes=engine._last_persons,
        )
        return frame, face_results, annotated
