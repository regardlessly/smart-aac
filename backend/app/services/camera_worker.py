"""Background camera capture and analysis worker."""

import threading
import time
import base64
import traceback
import sys
import logging

import cv2

logger = logging.getLogger('camera_worker')
logger.setLevel(logging.DEBUG)
handler = logging.StreamHandler(sys.stderr)
handler.setFormatter(logging.Formatter('[%(name)s] %(message)s'))
if not logger.handlers:
    logger.addHandler(handler)


class CameraWorker:
    """Background thread that captures from RTSP cameras and runs
    face recognition, writing results to PostgreSQL."""

    def __init__(self, app, interval_seconds=180):
        self.app = app
        self.interval = interval_seconds
        self.stop_event = threading.Event()
        self.thread = None

    def start(self):
        self.thread = threading.Thread(
            target=self._run, daemon=True, name='camera-worker')
        self.thread.start()
        logger.info(f'Started (interval={self.interval}s)')

    def stop(self):
        self.stop_event.set()

    def _run(self):
        # Wait a bit for the app to fully start
        time.sleep(5)
        logger.info('Worker thread awake, initializing...')

        with self.app.app_context():
            from .face_recognition_service import FaceRecognitionService
            from .presence_service import PresenceService
            from .alert_service import AlertService
            from ..models.camera import Camera, CCTVSnapshot
            from ..extensions import db
            from ..api.sse import push_event

            # Pre-warm the engine
            try:
                logger.info('Loading face recognition engine...')
                FaceRecognitionService.get_engine()
                logger.info('Engine loaded successfully')
            except Exception:
                logger.error('Failed to load engine:\n' + traceback.format_exc())
                return

            while not self.stop_event.is_set():
                try:
                    cameras = Camera.query.filter_by(enabled=True).all()

                    for camera in cameras:
                        if not camera.rtsp_url:
                            continue

                        logger.info(f'Capturing {camera.name}...')
                        frame, face_results, annotated = \
                            FaceRecognitionService.capture_and_analyze(
                                camera.rtsp_url, camera.name)

                        if frame is None:
                            logger.warning(f'{camera.name}: capture failed')
                            continue

                        identified = [
                            r for r in face_results
                            if r['name'] != 'Stranger']
                        unidentified = [
                            r for r in face_results
                            if r['name'] == 'Stranger']

                        # Encode annotated frame as base64 JPEG
                        _, jpeg = cv2.imencode(
                            '.jpg', annotated,
                            [cv2.IMWRITE_JPEG_QUALITY, 70])
                        b64 = base64.b64encode(
                            jpeg).decode('ascii')

                        # Save snapshot
                        snapshot = CCTVSnapshot(
                            camera_id=camera.id,
                            identified_count=len(identified),
                            unidentified_count=len(unidentified),
                            snapshot_b64=b64,
                        )
                        db.session.add(snapshot)

                        # Update senior presences
                        PresenceService.update_from_face_results(
                            face_results, camera, db.session)

                        # Generate alerts for strangers
                        if unidentified:
                            AlertService.create_stranger_alert(
                                camera, len(unidentified), db.session)

                        db.session.commit()

                        # Push SSE events
                        push_event({
                            'type': 'snapshot',
                            'camera_id': camera.id,
                            'camera_name': camera.name,
                            'identified': len(identified),
                            'unidentified': len(unidentified),
                        })

                        for r in identified:
                            push_event({
                                'type': 'detection',
                                'name': r['name'],
                                'score': round(r['score'], 3),
                                'camera_id': camera.id,
                            })

                        logger.info(f'{camera.name}: '
                                    f'{len(identified)} identified, '
                                    f'{len(unidentified)} unidentified')

                except Exception:
                    logger.error(traceback.format_exc())
                    try:
                        db.session.rollback()
                    except Exception:
                        pass

                self.stop_event.wait(self.interval)

        logger.info('Stopped.')
