from datetime import datetime, timezone

from ..extensions import db


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    odoo_uid = db.Column(db.String(64), unique=True, nullable=False)
    name = db.Column(db.String(128), nullable=False)
    email = db.Column(db.String(256), unique=True, nullable=False)
    odoo_access_token = db.Column(db.String(512), nullable=True)
    is_manager = db.Column(db.Boolean, default=False)
    is_volunteer = db.Column(db.Boolean, default=False)
    last_login = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            'id': self.id,
            'odoo_uid': self.odoo_uid,
            'name': self.name,
            'email': self.email,
            'is_manager': self.is_manager,
            'is_volunteer': self.is_volunteer,
            'last_login': self.last_login.isoformat() if self.last_login else None,
        }
