from ..extensions import db


class Locker(db.Model):
    __tablename__ = 'lockers'

    id = db.Column(db.Integer, primary_key=True)
    locker_number = db.Column(db.String(10), unique=True, nullable=False)
    status = db.Column(db.String(20), default='available')
    assigned_to = db.Column(
        db.Integer, db.ForeignKey('seniors.id'), nullable=True)
    equipment_description = db.Column(db.String(255), nullable=True)

    assigned_senior = db.relationship('Senior', backref='lockers')

    def to_dict(self):
        return {
            'id': self.id,
            'locker_number': self.locker_number,
            'status': self.status,
            'assigned_to': self.assigned_to,
            'assigned_to_name': self.assigned_senior.name
            if self.assigned_senior else None,
            'equipment_description': self.equipment_description,
        }
