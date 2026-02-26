from datetime import datetime, timezone

from ..extensions import db


class Camera(db.Model):
    __tablename__ = 'cameras'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    rtsp_url = db.Column(db.String(255), nullable=True)
    channel = db.Column(db.Integer, nullable=True)
    location = db.Column(db.String(100), nullable=True)
    enabled = db.Column(db.Boolean, default=True)

    snapshots = db.relationship(
        'CCTVSnapshot', backref='camera', lazy='dynamic')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'channel': self.channel,
            'location': self.location,
            'enabled': self.enabled,
        }


class CCTVSnapshot(db.Model):
    __tablename__ = 'cctv_snapshots'

    id = db.Column(db.Integer, primary_key=True)
    camera_id = db.Column(
        db.Integer, db.ForeignKey('cameras.id'), nullable=False)
    timestamp = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc))
    identified_count = db.Column(db.Integer, default=0)
    unidentified_count = db.Column(db.Integer, default=0)
    snapshot_path = db.Column(db.String(255), nullable=True)
    snapshot_b64 = db.Column(db.Text, nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'camera_id': self.camera_id,
            'camera_name': self.camera.name if self.camera else None,
            'timestamp': self.timestamp.isoformat()
            if self.timestamp else None,
            'identified_count': self.identified_count,
            'unidentified_count': self.unidentified_count,
            'snapshot_b64': self.snapshot_b64,
        }
