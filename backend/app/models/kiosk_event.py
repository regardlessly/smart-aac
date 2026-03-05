from datetime import datetime, timezone

from ..extensions import db


class KioskEvent(db.Model):
    __tablename__ = 'kiosk_events'

    id = db.Column(db.Integer, primary_key=True)
    senior_id = db.Column(
        db.Integer, db.ForeignKey('seniors.id'), nullable=True)
    event_type = db.Column(db.String(50), nullable=False)
    activity_id = db.Column(
        db.Integer, db.ForeignKey('activities.id'), nullable=True)
    locker_id = db.Column(
        db.Integer, db.ForeignKey('lockers.id'), nullable=True)
    timestamp = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc),
        index=True)

    activity = db.relationship('Activity')
    locker = db.relationship('Locker')

    def to_dict(self):
        return {
            'id': self.id,
            'senior_id': self.senior_id,
            'senior_name': self.senior.name if self.senior else None,
            'event_type': self.event_type,
            'activity_id': self.activity_id,
            'activity_name': self.activity.name
            if self.activity else None,
            'locker_id': self.locker_id,
            'locker_number': self.locker.locker_number
            if self.locker else None,
            'timestamp': self.timestamp.isoformat()
            if self.timestamp else None,
        }
