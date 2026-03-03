"""Thin lifecycle wrapper around FaceRecognitionService.

FaceRecognizer manages its own camera threads
internally. This class simply starts and stops it through the
FaceRecognitionService singleton bridge.
"""

import logging
import sys

logger = logging.getLogger('camera_worker')
logger.setLevel(logging.DEBUG)
handler = logging.StreamHandler(sys.stderr)
handler.setFormatter(logging.Formatter('[%(name)s] %(message)s'))
if not logger.handlers:
    logger.addHandler(handler)


class CameraWorker:
    """Manages the FaceRecognizer lifecycle."""

    def __init__(self, app):
        self.app = app

    def start(self):
        from .face_recognition_service import FaceRecognitionService
        logger.info('Starting FaceRecognizer via FaceRecognitionService...')
        try:
            FaceRecognitionService.start(self.app)
        except Exception:
            logger.error('Failed to start FaceRecognizer', exc_info=True)

    def stop(self):
        from .face_recognition_service import FaceRecognitionService
        logger.info('Stopping FaceRecognizer...')
        summary = FaceRecognitionService.stop()
        if summary:
            logger.info(
                'Session summary: %d known, %d unknown detected',
                len(summary.get('known_persons', {})),
                len(summary.get('unknown_persons', {})))
        logger.info('Stopped.')
