from datetime import datetime, timezone

from ..extensions import db


class Camera(db.Model):
    __tablename__ = 'cameras'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    rtsp_url = db.Column(db.String(255), nullable=True)
    channel = db.Column(db.Integer, nullable=True)
    location = db.Column(db.String(100), nullable=True)
    room_id = db.Column(
        db.Integer, db.ForeignKey('rooms.id'), nullable=True)
    enabled = db.Column(db.Boolean, default=True)

    room = db.relationship('Room', backref='cameras')
    snapshots = db.relationship(
        'CCTVSnapshot', backref='camera', lazy='dynamic')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'channel': self.channel,
            'location': self.location,
            'room_id': self.room_id,
            'room_name': self.room.name if self.room else None,
            'enabled': self.enabled,
        }

    def to_admin_dict(self):
        """Include rtsp_url for admin/settings pages."""
        d = self.to_dict()
        d['rtsp_url'] = self.rtsp_url
        return d


class CCTVSnapshot(db.Model):
    __tablename__ = 'cctv_snapshots'

    id = db.Column(db.Integer, primary_key=True)
    camera_id = db.Column(
        db.Integer, db.ForeignKey('cameras.id'), nullable=False)
    timestamp = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc))
    identified_count = db.Column(db.Integer, default=0)
    unidentified_count = db.Column(db.Integer, default=0)
    identified_names = db.Column(db.Text, nullable=True)  # JSON list
    snapshot_path = db.Column(db.String(255), nullable=True)
    snapshot_b64 = db.Column(db.Text, nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'camera_id': self.camera_id,
            'camera_name': self.camera.name if self.camera else None,
            'timestamp': (self.timestamp.isoformat() + 'Z')
            if self.timestamp else None,
            'identified_count': self.identified_count,
            'unidentified_count': self.unidentified_count,
            'snapshot_b64': self.snapshot_b64,
        }
