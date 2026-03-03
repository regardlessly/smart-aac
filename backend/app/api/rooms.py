from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models.room import Room
from .auth import login_required

bp = Blueprint('rooms', __name__)


@bp.route('/api/rooms')
@login_required
def list_rooms():
    rooms = Room.query.order_by(Room.name).all()
    return jsonify([r.to_dict() for r in rooms])


@bp.route('/api/rooms/<int:room_id>')
@login_required
def get_room(room_id):
    room = Room.query.get_or_404(room_id)
    data = room.to_dict()
    presences = [p.to_dict() for p in room.presences.filter_by(
        is_current=True).all()]
    data['presences'] = presences
    return jsonify(data)


@bp.route('/api/rooms/heatmap')
@login_required
def heatmap():
    """Return room occupancy heatmap from latest camera snapshots.

    Deduplicates identified persons across cameras in the same room
    using the identified_names list stored in each snapshot.
    Strangers: max(unidentified_count) across cameras in the room
    (the same stranger may appear in multiple camera views).
    """
    import json as _json
    from sqlalchemy import func
    from ..models.camera import Camera, CCTVSnapshot

    # Latest snapshot per camera
    latest_snap = db.session.query(
        CCTVSnapshot.camera_id,
        func.max(CCTVSnapshot.id).label('max_id'),
    ).group_by(CCTVSnapshot.camera_id).subquery()

    # Fetch latest snapshots with room info
    rows = db.session.query(
        Camera.room_id,
        CCTVSnapshot.identified_count,
        CCTVSnapshot.unidentified_count,
        CCTVSnapshot.identified_names,
    ).join(
        latest_snap, Camera.id == latest_snap.c.camera_id
    ).join(
        CCTVSnapshot, CCTVSnapshot.id == latest_snap.c.max_id
    ).filter(
        Camera.room_id.isnot(None),
    ).all()

    # Per-room: collect per-camera data for cross-camera deduplication
    # Each entry: (identified_names_set, unidentified_count)
    room_camera_data: dict[int, list[tuple[set, int]]] = {}
    room_all_names: dict[int, set] = {}
    for room_id, id_count, unid_count, names_json in rows:
        if names_json:
            try:
                names = set(_json.loads(names_json))
            except (ValueError, TypeError):
                names = set()
        else:
            names = set()
        room_camera_data.setdefault(room_id, []).append(
            (names, unid_count or 0))
        room_all_names.setdefault(room_id, set()).update(names)

    rooms = Room.query.order_by(Room.id).all()
    result = []
    for room in rooms:
        all_names = room_all_names.get(room.id, set())
        known = len(all_names)
        # Adjust stranger count: a stranger on one camera might be a
        # person identified by another camera. For each camera, subtract
        # the number of people identified elsewhere but not on this camera.
        strangers = 0
        for cam_names, cam_strangers in room_camera_data.get(
                room.id, []):
            identified_elsewhere = len(all_names - cam_names)
            adjusted = max(0, cam_strangers - identified_elsewhere)
            strangers = max(strangers, adjusted)
        occ = known + strangers
        cap = room.max_capacity or 1
        if occ == 0:
            color_level = 'empty'
        elif occ / cap <= 0.3:
            color_level = 'low'
        elif occ / cap <= 0.7:
            color_level = 'medium'
        else:
            color_level = 'high'
        result.append({
            'id': room.id,
            'name': room.name,
            'occupancy': occ,
            'max_capacity': room.max_capacity,
            'identified': known,
            'strangers': strangers,
            'color_level': color_level,
        })

    return jsonify(result)


@bp.route('/api/rooms', methods=['POST'])
@login_required
def create_room():
    """Create a new room."""
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    room = Room(
        name=name,
        max_capacity=int(data.get('max_capacity', 20)),
    )
    db.session.add(room)
    db.session.commit()
    return jsonify(room.to_dict()), 201


@bp.route('/api/rooms/<int:room_id>', methods=['PUT'])
@login_required
def update_room(room_id):
    """Update an existing room."""
    room = db.session.get(Room, room_id)
    if room is None:
        return jsonify({'error': 'Room not found'}), 404

    data = request.get_json() or {}
    if 'name' in data:
        room.name = data['name'].strip()
    if 'max_capacity' in data:
        room.max_capacity = int(data['max_capacity'])

    db.session.commit()
    return jsonify(room.to_dict())


@bp.route('/api/rooms/<int:room_id>', methods=['DELETE'])
@login_required
def delete_room(room_id):
    """Delete a room (unlinks cameras first)."""
    room = db.session.get(Room, room_id)
    if room is None:
        return jsonify({'error': 'Room not found'}), 404

    # Unlink cameras assigned to this room
    for cam in room.cameras:
        cam.room_id = None

    db.session.delete(room)
    db.session.commit()
    return jsonify({'status': 'ok', 'id': room_id})
