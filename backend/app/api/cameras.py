from flask import Blueprint, jsonify
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
