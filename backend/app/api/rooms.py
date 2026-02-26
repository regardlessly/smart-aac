from flask import Blueprint, jsonify

from ..models.room import Room

bp = Blueprint('rooms', __name__)


@bp.route('/api/rooms')
def list_rooms():
    rooms = Room.query.order_by(Room.name).all()
    return jsonify([r.to_dict() for r in rooms])


@bp.route('/api/rooms/<int:room_id>')
def get_room(room_id):
    room = Room.query.get_or_404(room_id)
    data = room.to_dict()
    presences = [p.to_dict() for p in room.presences.filter_by(
        is_current=True).all()]
    data['presences'] = presences
    return jsonify(data)


@bp.route('/api/rooms/heatmap')
def heatmap():
    rooms = Room.query.order_by(Room.id).all()
    return jsonify([r.heatmap_dict() for r in rooms])
