"""Application-level key-value configuration stored in the database."""

from ..extensions import db


class AppConfig(db.Model):
    __tablename__ = 'app_config'

    key = db.Column(db.String(64), primary_key=True)
    value = db.Column(db.Text, nullable=True)

    @classmethod
    def get(cls, key: str, default: str | None = None) -> str | None:
        row = cls.query.get(key)
        return row.value if row else default

    @classmethod
    def set(cls, key: str, value: str) -> None:
        row = cls.query.get(key)
        if row:
            row.value = value
        else:
            db.session.add(cls(key=key, value=value))
        db.session.commit()
