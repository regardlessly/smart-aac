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
    """Return room occupancy heatmap with cross-camera deduplication.

    Uses face embeddings to match the same stranger across multiple
    cameras in the same room, giving a more accurate person count
    than simply taking MAX(unidentified) across cameras.
    """
    from ..models.camera import Camera
    from ..services.face_recognition_service import FaceRecognitionService

    # Build room -> camera names mapping
    cameras = Camera.query.filter(
        Camera.room_id.isnot(None), Camera.enabled.is_(True)
    ).all()
    room_cameras: dict[int, list[str]] = {}
    for cam in cameras:
        room_cameras.setdefault(cam.room_id, []).append(cam.name)

    rooms = Room.query.order_by(Room.id).all()
    result = []
    for room in rooms:
        cam_names = room_cameras.get(room.id, [])
        if cam_names:
            occ = FaceRecognitionService.get_room_occupancy(cam_names)
            known = occ['identified']
            strangers = occ['strangers']
            face_total = occ['total']
            body_max = occ['person_count_max']
            # Use the higher of face dedup count and YOLO body count
            total = max(face_total, body_max)
        else:
            known = 0
            strangers = 0
            body_max = 0
            total = 0

        room.current_occupancy = total
        result.append({
            'id': room.id,
            'name': room.name,
            'occupancy': total,
            'max_capacity': room.max_capacity,
            'moderate_threshold': room.moderate_threshold,
            'identified': known,
            'strangers': strangers,
            'color_level': room._get_color_level(total),
        })

    return jsonify(result)


@bp.route('/api/rooms/occupancy-debug')
def occupancy_debug():
    """Temporary debug: show cross-camera dedup results (no auth)."""
    from ..models.camera import Camera
    from ..services.face_recognition_service import FaceRecognitionService as FRS

    cameras = Camera.query.filter(
        Camera.room_id.isnot(None), Camera.enabled.is_(True)
    ).all()
    room_cameras: dict[int, list[str]] = {}
    for cam in cameras:
        room_cameras.setdefault(cam.room_id, []).append(cam.name)

    rooms = Room.query.order_by(Room.id).all()
    result = []
    for room in rooms:
        cam_names = room_cameras.get(room.id, [])
        if cam_names:
            occ = FRS.get_room_occupancy(cam_names)
            # Also show raw per-camera data
            raw = {}
            for cn in cam_names:
                d = FRS._camera_face_data.get(cn, {})
                raw[cn] = {
                    'persons': d.get('person_count', 0),
                    'strangers_with_face': len(d.get('stranger_embeddings', [])),
                    'identified': d.get('identified', []),
                }
            result.append({
                'room': room.name,
                'cameras': cam_names,
                'raw_per_camera': raw,
                'deduped': occ,
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

    mod = data.get('moderate_threshold')
    room = Room(
        name=name,
        max_capacity=int(data.get('max_capacity', 20)),
        moderate_threshold=int(mod) if mod is not None else None,
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
    if 'moderate_threshold' in data:
        val = data['moderate_threshold']
        room.moderate_threshold = int(val) if val is not None else None

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
