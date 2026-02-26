"""Generate alerts from detection events."""

from datetime import datetime, timezone

from ..models.alert import Alert


class AlertService:

    @staticmethod
    def create_stranger_alert(camera, stranger_count, session):
        """Create an alert when unidentified persons are detected."""
        alert = Alert(
            type='warning',
            title=f'Unidentified Person{"s" if stranger_count > 1 else ""}'
                  f' Detected',
            description=f'{stranger_count} unidentified person'
                        f'{"s" if stranger_count > 1 else ""} detected '
                        f'by {camera.name}.',
            camera_id=camera.id,
            created_at=datetime.now(timezone.utc),
        )
        session.add(alert)
        return alert
