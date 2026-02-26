from datetime import datetime, timezone

from ..extensions import db


class Senior(db.Model):
    __tablename__ = 'seniors'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    nric_last4 = db.Column(db.String(5), nullable=False)
    photo_path = db.Column(db.String(255), nullable=True)
    registered_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc))
    is_active = db.Column(db.Boolean, default=True)

    presences = db.relationship(
        'SeniorPresence', backref='senior', lazy='dynamic')
    kiosk_events = db.relationship(
        'KioskEvent', backref='senior', lazy='dynamic')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'nric_last4': self.nric_last4,
            'photo_path': self.photo_path,
            'registered_at': self.registered_at.isoformat()
            if self.registered_at else None,
            'is_active': self.is_active,
        }


class SeniorPresence(db.Model):
    __tablename__ = 'senior_presences'

    id = db.Column(db.Integer, primary_key=True)
    senior_id = db.Column(
        db.Integer, db.ForeignKey('seniors.id'), nullable=True)
    room_id = db.Column(
        db.Integer, db.ForeignKey('rooms.id'), nullable=True)
    camera_id = db.Column(
        db.Integer, db.ForeignKey('cameras.id'), nullable=True)
    arrived_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc))
    last_seen_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc))
    status = db.Column(db.String(20), default='identified')
    is_current = db.Column(db.Boolean, default=True)

    room = db.relationship('Room', backref='presences')
    camera = db.relationship('Camera', backref='presences')

    def to_dict(self):
        return {
            'id': self.id,
            'senior_id': self.senior_id,
            'senior_name': self.senior.name if self.senior else None,
            'nric_last4': self.senior.nric_last4
            if self.senior else None,
            'photo_path': self.senior.photo_path
            if self.senior else None,
            'room_name': self.room.name if self.room else None,
            'room_id': self.room_id,
            'arrived_at': self.arrived_at.isoformat()
            if self.arrived_at else None,
            'last_seen_at': self.last_seen_at.isoformat()
            if self.last_seen_at else None,
            'status': self.status,
            'is_current': self.is_current,
        }
