from ..extensions import db


class Room(db.Model):
    __tablename__ = 'rooms'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    max_capacity = db.Column(db.Integer, default=20)
    current_occupancy = db.Column(db.Integer, default=0)

    activities = db.relationship('Activity', backref='room', lazy='dynamic')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'max_capacity': self.max_capacity,
            'current_occupancy': self.current_occupancy,
        }

    def heatmap_dict(self):
        if self.current_occupancy == 0:
            color_level = 'empty'
        elif self.current_occupancy / self.max_capacity <= 0.3:
            color_level = 'low'
        elif self.current_occupancy / self.max_capacity <= 0.7:
            color_level = 'medium'
        else:
            color_level = 'high'

        return {
            'id': self.id,
            'name': self.name,
            'occupancy': self.current_occupancy,
            'max_capacity': self.max_capacity,
            'color_level': color_level,
        }
