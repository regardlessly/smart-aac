from ..extensions import db


class Room(db.Model):
    __tablename__ = 'rooms'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    max_capacity = db.Column(db.Integer, default=20)
    moderate_threshold = db.Column(db.Integer, nullable=True)
    current_occupancy = db.Column(db.Integer, default=0)

    activities = db.relationship('Activity', backref='room', lazy='dynamic')

    def _get_color_level(self, occupancy):
        """Determine heatmap color level for a given occupancy count.

        Thresholds:
          empty    – 0 people
          low      – 1 to moderate_threshold-1
          medium   – moderate_threshold to max_capacity-1
          high     – max_capacity or above

        If moderate_threshold is not set, defaults to 30 % of max_capacity.
        """
        if occupancy == 0:
            return 'empty'
        cap = self.max_capacity or 1
        mod = self.moderate_threshold
        if mod is None:
            # Fallback: percentage-based
            if occupancy / cap <= 0.3:
                return 'low'
            elif occupancy / cap <= 0.7:
                return 'medium'
            else:
                return 'high'
        if occupancy < mod:
            return 'low'
        if occupancy < cap:
            return 'medium'
        return 'high'

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'max_capacity': self.max_capacity,
            'moderate_threshold': self.moderate_threshold,
            'current_occupancy': self.current_occupancy,
        }

    def heatmap_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'occupancy': self.current_occupancy,
            'max_capacity': self.max_capacity,
            'moderate_threshold': self.moderate_threshold,
            'color_level': self._get_color_level(self.current_occupancy),
        }
