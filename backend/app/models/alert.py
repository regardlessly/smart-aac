from datetime import datetime, timezone

from ..extensions import db


class Alert(db.Model):
    __tablename__ = 'alerts'

    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(20), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    camera_id = db.Column(
        db.Integer, db.ForeignKey('cameras.id'), nullable=True)
    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc))
    acknowledged = db.Column(db.Boolean, default=False)

    camera = db.relationship('Camera', backref='alerts')

    def to_dict(self):
        return {
            'id': self.id,
            'type': self.type,
            'title': self.title,
            'description': self.description,
            'camera_id': self.camera_id,
            'camera_name': self.camera.name if self.camera else None,
            'created_at': self.created_at.isoformat()
            if self.created_at else None,
            'acknowledged': self.acknowledged,
        }
