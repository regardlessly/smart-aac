from datetime import datetime, timezone

from ..extensions import db


class Activity(db.Model):
    __tablename__ = 'activities'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    room_id = db.Column(
        db.Integer, db.ForeignKey('rooms.id'), nullable=True)
    scheduled_time = db.Column(db.DateTime, nullable=False, index=True)
    end_time = db.Column(db.DateTime, nullable=True)
    status = db.Column(db.String(20), default='upcoming', index=True)
    attendee_count = db.Column(db.Integer, default=0)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'room_id': self.room_id,
            'room_name': self.room.name if self.room else None,
            'scheduled_time': self.scheduled_time.isoformat()
            if self.scheduled_time else None,
            'end_time': self.end_time.isoformat()
            if self.end_time else None,
            'status': self.status,
            'attendee_count': self.attendee_count,
        }
