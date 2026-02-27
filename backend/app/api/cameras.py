import os
import tempfile

from flask import Blueprint, jsonify, request
from sqlalchemy import func

from ..extensions import db
from ..models.camera import Camera, CCTVSnapshot

bp = Blueprint('cameras', __name__)


@bp.route('/api/cameras')
def list_cameras():
    cameras = Camera.query.order_by(Camera.id).all()
    return jsonify([c.to_dict() for c in cameras])


@bp.route('/api/cameras/<int:camera_id>/snapshot')
def get_snapshot(camera_id):
    snapshot = CCTVSnapshot.query.filter_by(
        camera_id=camera_id
    ).order_by(CCTVSnapshot.timestamp.desc()).first()

    if snapshot is None:
        return jsonify({'error': 'No snapshot available'}), 404

    return jsonify(snapshot.to_dict())


@bp.route('/api/cameras/snapshots/latest')
def latest_snapshots():
    """Return the most recent snapshot for each camera."""
    # Subquery for max timestamp per camera
    latest_ts = db.session.query(
        CCTVSnapshot.camera_id,
        func.max(CCTVSnapshot.id).label('max_id')
    ).group_by(CCTVSnapshot.camera_id).subquery()

    snapshots = db.session.query(CCTVSnapshot).join(
        latest_ts,
        CCTVSnapshot.id == latest_ts.c.max_id
    ).all()

    # Include cameras without snapshots
    all_cameras = Camera.query.order_by(Camera.id).all()
    snapshot_map = {s.camera_id: s for s in snapshots}

    result = []
    for cam in all_cameras:
        snap = snapshot_map.get(cam.id)
        result.append({
            'camera_id': cam.id,
            'camera_name': cam.name,
            'location': cam.location,
            'enabled': cam.enabled,
            'snapshot_b64': snap.snapshot_b64 if snap else None,
            'identified_count': snap.identified_count if snap else 0,
            'unidentified_count': snap.unidentified_count if snap else 0,
            'timestamp': snap.timestamp.isoformat()
            if snap else None,
        })

    return jsonify(result)


@bp.route('/api/cameras/admin')
def list_cameras_admin():
    """List cameras with rtsp_url exposed (for settings page)."""
    cameras = Camera.query.order_by(Camera.id).all()
    return jsonify([c.to_admin_dict() for c in cameras])


@bp.route('/api/cameras', methods=['POST'])
def create_camera():
    """Create a new camera."""
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    camera = Camera(
        name=name,
        rtsp_url=data.get('rtsp_url', '').strip() or None,
        location=data.get('location', '').strip() or None,
        enabled=data.get('enabled', True),
    )
    db.session.add(camera)
    db.session.commit()
    return jsonify(camera.to_admin_dict()), 201


@bp.route('/api/cameras/<int:camera_id>', methods=['PUT'])
def update_camera(camera_id):
    """Update an existing camera."""
    camera = db.session.get(Camera, camera_id)
    if camera is None:
        return jsonify({'error': 'Camera not found'}), 404

    data = request.get_json() or {}
    if 'name' in data:
        camera.name = data['name'].strip()
    if 'rtsp_url' in data:
        camera.rtsp_url = data['rtsp_url'].strip() or None
    if 'location' in data:
        camera.location = data['location'].strip() or None
    if 'enabled' in data:
        camera.enabled = bool(data['enabled'])

    db.session.commit()
    return jsonify(camera.to_admin_dict())


@bp.route('/api/cameras/<int:camera_id>', methods=['DELETE'])
def delete_camera(camera_id):
    """Delete a camera and its snapshots."""
    camera = db.session.get(Camera, camera_id)
    if camera is None:
        return jsonify({'error': 'Camera not found'}), 404

    # Delete associated snapshots first
    CCTVSnapshot.query.filter_by(camera_id=camera_id).delete()
    db.session.delete(camera)
    db.session.commit()
    return jsonify({'status': 'ok', 'id': camera_id})


@bp.route('/api/cameras/status')
def camera_status():
    """Return FaceRecognizer session status."""
    from ..services.face_recognition_service import FaceRecognitionService
    status = FaceRecognitionService.get_status()
    return jsonify(status)


@bp.route('/api/cameras/known-faces')
def list_known_faces():
    """List known face names and image counts from the known_faces directory."""
    from ..services.face_recognition_service import FaceRecognitionService
    fr_dir = FaceRecognitionService._fr_dir or os.path.abspath(
        os.path.join(os.path.dirname(__file__), '..', '..', '..', '..',
                     'face_recognizer'))
    known_dir = os.path.join(fr_dir, 'known_faces')

    # known_faces stores flat files: Name.jpg, Name_auto_*.jpg
    # Group by person name (filename stem before first _auto_ or before extension)
    person_counts = {}
    if os.path.isdir(known_dir):
        for fname in sorted(os.listdir(known_dir)):
            if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            # Extract person name: split on _auto_ first, then strip extension
            if '_auto_' in fname:
                person = fname.split('_auto_')[0]
            else:
                person = os.path.splitext(fname)[0]
            person_counts[person] = person_counts.get(person, 0) + 1

    faces = [{'name': name, 'image_count': count}
             for name, count in sorted(person_counts.items())]
    return jsonify(faces)


@bp.route('/api/cameras/known-faces', methods=['POST'])
def add_known_face():
    """Add a known face image.

    Expects multipart/form-data with:
      - name: person name
      - image: image file
    """
    from ..services.face_recognition_service import FaceRecognitionService

    name = request.form.get('name')
    if not name:
        return jsonify({'error': 'name is required'}), 400

    image = request.files.get('image')
    if not image:
        return jsonify({'error': 'image file is required'}), 400

    ext = os.path.splitext(image.filename)[1] or '.jpg'
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        image.save(tmp)
        tmp_path = tmp.name

    try:
        FaceRecognitionService.add_known_face(name, tmp_path)
        return jsonify({'status': 'ok', 'name': name})
    finally:
        os.unlink(tmp_path)


@bp.route('/api/cameras/known-faces/<name>', methods=['DELETE'])
def remove_known_face(name):
    """Remove all known face images for a person."""
    from ..services.face_recognition_service import FaceRecognitionService
    FaceRecognitionService.remove_known_face(name)
    return jsonify({'status': 'ok', 'name': name})
