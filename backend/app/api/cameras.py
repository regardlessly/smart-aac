import base64
import math
import os
import shutil
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests as http_requests
from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from ..extensions import db
from ..models.camera import Camera, CCTVSnapshot
from .auth import login_required

bp = Blueprint('cameras', __name__)


@bp.route('/api/cameras')
@login_required
def list_cameras():
    cameras = Camera.query.options(
        joinedload(Camera.room),
    ).order_by(Camera.id).all()
    return jsonify([c.to_dict() for c in cameras])


@bp.route('/api/cameras/<int:camera_id>/snapshot')
@login_required
def get_snapshot(camera_id):
    snapshot = CCTVSnapshot.query.filter_by(
        camera_id=camera_id
    ).order_by(CCTVSnapshot.timestamp.desc()).first()

    if snapshot is None:
        return jsonify({'error': 'No snapshot available'}), 404

    return jsonify(snapshot.to_dict())


@bp.route('/api/cameras/snapshots/latest')
@login_required
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
    all_cameras = Camera.query.options(
        joinedload(Camera.room),
    ).order_by(Camera.id).all()
    snapshot_map = {s.camera_id: s for s in snapshots}

    result = []
    for cam in all_cameras:
        snap = snapshot_map.get(cam.id)
        result.append({
            'camera_id': cam.id,
            'camera_name': cam.name,
            'location': cam.room.name if cam.room else cam.location,
            'room_id': cam.room_id,
            'room_name': cam.room.name if cam.room else None,
            'enabled': cam.enabled,
            'snapshot_b64': snap.snapshot_b64 if snap else None,
            'identified_count': snap.identified_count if snap else 0,
            'unidentified_count': snap.unidentified_count if snap else 0,
            'timestamp': (snap.timestamp.isoformat() + 'Z')
            if snap else None,
        })

    return jsonify(result)


@bp.route('/api/cameras/admin')
@login_required
def list_cameras_admin():
    """List cameras with rtsp_url exposed (for settings page)."""
    cameras = Camera.query.options(
        joinedload(Camera.room),
    ).order_by(Camera.id).all()
    return jsonify([c.to_admin_dict() for c in cameras])


@bp.route('/api/cameras', methods=['POST'])
@login_required
def create_camera():
    """Create a new camera."""
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    room_id = data.get('room_id')
    camera = Camera(
        name=name,
        rtsp_url=data.get('rtsp_url', '').strip() or None,
        location=data.get('location', '').strip() or None,
        room_id=int(room_id) if room_id else None,
        enabled=data.get('enabled', True),
    )
    db.session.add(camera)
    db.session.commit()
    return jsonify(camera.to_admin_dict()), 201


@bp.route('/api/cameras/<int:camera_id>', methods=['PUT'])
@login_required
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
    if 'room_id' in data:
        val = data['room_id']
        camera.room_id = int(val) if val else None
    if 'enabled' in data:
        camera.enabled = bool(data['enabled'])

    db.session.commit()
    return jsonify(camera.to_admin_dict())


@bp.route('/api/cameras/<int:camera_id>', methods=['DELETE'])
@login_required
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
@login_required
def camera_status():
    """Return FaceRecognizer session status."""
    from ..services.face_recognition_service import FaceRecognitionService
    status = FaceRecognitionService.get_status()
    return jsonify(status)


@bp.route('/api/cameras/recent-detections')
@login_required
def recent_detections():
    """Return the most recent SeniorPresence entries as detection events.

    Used as a polling fallback when SSE is unavailable.
    Returns up to 50 most recent presences from the last 30 minutes.
    """
    from datetime import datetime, timezone, timedelta
    from ..models.senior import SeniorPresence

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    presences = SeniorPresence.query.options(
        joinedload(SeniorPresence.senior),
        joinedload(SeniorPresence.camera),
    ).filter(
        SeniorPresence.last_seen_at >= cutoff
    ).order_by(SeniorPresence.last_seen_at.desc()).limit(50).all()

    result = []
    for p in presences:
        cam = p.camera
        result.append({
            'id': p.id,
            'person': p.senior.name if p.senior else 'Stranger',
            'personType': 'known' if p.status == 'identified' else 'unknown',
            'cameraName': cam.name if cam else '',
            'confidence': 0,
            'timestamp': (p.last_seen_at.isoformat() + 'Z')
            if p.last_seen_at else None,
            'crop': None,
        })

    return jsonify(result)


@bp.route('/api/cameras/known-faces')
@login_required
def list_known_faces():
    """List known face names and image counts from the known_faces directory."""
    data_dir = current_app.config['FACE_DATA_DIR']
    known_dir = os.path.join(data_dir, 'known_faces')

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
@login_required
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
@login_required
def remove_known_face(name):
    """Remove all known face images for a person."""
    from ..services.face_recognition_service import FaceRecognitionService

    # Delete files directly from disk (works even if engine isn't loaded)
    data_dir = current_app.config['FACE_DATA_DIR']
    known_dir = os.path.join(data_dir, 'known_faces')
    removed = 0
    if os.path.isdir(known_dir):
        for fname in os.listdir(known_dir):
            if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            # Match: exact name prefix (case-insensitive) followed by
            # extension, _number.ext, or _auto_.ext
            base = os.path.splitext(fname)[0]
            if (base.lower() == name.lower()
                    or base.lower().startswith(name.lower() + '_')):
                os.remove(os.path.join(known_dir, fname))
                removed += 1

    # Hot-reload engine if running
    try:
        FaceRecognitionService.reload_known_faces()
    except Exception:
        pass

    return jsonify({'status': 'ok', 'name': name, 'removed': removed})


@bp.route('/api/cameras/clear-data', methods=['POST'])
@login_required
def clear_cctv_data():
    """Clear all CCTV captures, output, known faces, and DB snapshots."""
    from ..services.face_recognition_service import FaceRecognitionService

    data_dir = current_app.config['FACE_DATA_DIR']

    # 1. Clear DB snapshots
    count = CCTVSnapshot.query.delete()
    db.session.commit()

    # 2. Clear filesystem directories
    for dirname in ('captures', 'output', 'known_faces'):
        dirpath = os.path.join(data_dir, dirname)
        if os.path.isdir(dirpath):
            shutil.rmtree(dirpath)
        os.makedirs(dirpath, exist_ok=True)

    # 3. Hot-reload known faces (now empty)
    with FaceRecognitionService._lock:
        if FaceRecognitionService._instance:
            engine = getattr(FaceRecognitionService._instance, '_engine', None)
            if engine:
                engine._load_known_faces()

    return jsonify({
        'status': 'ok',
        'cleared': {'snapshots': count},
    })


# ---------------------------------------------------------------------------
# Sync known faces from Odoo member profiles
# ---------------------------------------------------------------------------

def _resolve_profile_image(profile_image, odoo_base_url):
    """Download or decode a profileImage value into (ext, bytes).

    Handles full URLs, relative URLs, and base64 data URIs.
    Returns (extension, image_bytes) or None on failure.
    """
    if not profile_image:
        return None

    # Base64 data URI
    if profile_image.startswith('data:image/'):
        try:
            header, b64_data = profile_image.split(',', 1)
            ext = header.split('/')[1].split(';')[0]
            return (ext, base64.b64decode(b64_data))
        except Exception:
            return None

    # Build full URL
    if profile_image.startswith(('http://', 'https://')):
        url = profile_image
    elif profile_image.startswith('/'):
        url = odoo_base_url.rstrip('/') + profile_image
    else:
        url = odoo_base_url.rstrip('/') + '/' + profile_image

    try:
        resp = http_requests.get(url, timeout=15)
        if resp.status_code != 200 or len(resp.content) < 100:
            return None
    except http_requests.RequestException:
        return None

    ct = resp.headers.get('Content-Type', '')
    if 'png' in ct:
        ext = 'png'
    else:
        ext = 'jpg'

    return (ext, resp.content)


def _download_member_face(member, odoo_base, known_faces_dir):
    """Download a single member's profile image. Returns (name, status)."""
    name = (member.get('name') or '').strip()
    profile_image = member.get('profileImage')

    if not name or not profile_image:
        return (name or '?', 'skipped', None)

    try:
        resolved = _resolve_profile_image(profile_image, odoo_base)
        if resolved is None:
            return (name, 'skipped', None)

        ext, image_bytes = resolved
        safe_name = name.replace(' ', '_')

        existing = [f for f in os.listdir(known_faces_dir)
                    if f.lower().startswith(safe_name.lower())
                    and f.lower().endswith(('.jpg', '.jpeg', '.png'))]
        if existing:
            filename = f'{safe_name}_{len(existing)+1}.{ext}'
        else:
            filename = f'{safe_name}.{ext}'
        dest = os.path.join(known_faces_dir, filename)
        with open(dest, 'wb') as f:
            f.write(image_bytes)

        return (name, 'synced', None)

    except Exception as e:
        return (name, 'error', str(e))


def _run_sync_background(app, odoo_base, centre_id, access_token,
                         known_faces_dir):
    """Background thread: fetch members from Odoo, download images concurrently."""
    from .sse import push_event

    with app.app_context():
        all_members = []
        errors = []
        page = 1

        # Phase 1: Fetch all member records (fast, sequential pagination)
        while True:
            try:
                resp = http_requests.get(
                    f'{odoo_base}/centre_ops/all_members',
                    params={'page': page, 'centre_id': f'[{centre_id}]'},
                    headers={'access-token': access_token},
                    timeout=30,
                )
            except http_requests.RequestException as e:
                errors.append(f'Network error on page {page}: {e}')
                break

            if resp.status_code != 200:
                errors.append(
                    f'Odoo API returned {resp.status_code} on page {page}')
                break

            data = resp.json()
            members = data.get('result', [])
            if isinstance(members, dict):
                members = members.get('data', [])
            if not members:
                break

            all_members.extend(members)

            total_records = int(data.get('total_records', 0))
            per_page = (int(data.get('count', len(members)))
                        or len(members))
            total_pages = (math.ceil(total_records / per_page)
                          if per_page else 1)
            if page >= total_pages:
                break
            page += 1

        total = len(all_members)
        push_event({
            'type': 'sync_progress',
            'phase': 'downloading',
            'synced': 0,
            'skipped': 0,
            'total': total,
            'name': '',
        })

        # Phase 2: Download images concurrently (8 workers)
        synced = 0
        skipped = 0
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(
                    _download_member_face, m, odoo_base, known_faces_dir
                ): m
                for m in all_members
            }
            for future in as_completed(futures):
                name, status, err = future.result()
                if status == 'synced':
                    synced += 1
                elif status == 'skipped':
                    skipped += 1
                else:
                    errors.append(f'{name}: {err}')

                push_event({
                    'type': 'sync_progress',
                    'phase': 'downloading',
                    'synced': synced,
                    'skipped': skipped,
                    'total': total,
                    'name': name if status == 'synced' else '',
                })

        # Phase 3: Reload face engine once
        if synced > 0:
            try:
                from ..services.face_recognition_service import (
                    FaceRecognitionService)
                FaceRecognitionService.reload_known_faces()
            except Exception:
                pass

        push_event({
            'type': 'sync_complete',
            'synced': synced,
            'skipped': skipped,
            'total': total,
            'errors': errors[:10],
        })


@bp.route('/api/cameras/known-faces/sync-odoo', methods=['POST'])
@login_required
def sync_known_faces_from_odoo():
    """Start syncing known faces from Odoo member profiles (background).

    Returns immediately. Progress is pushed via SSE events:
      - sync_progress: {phase, synced, skipped, total, name}
      - sync_complete: {synced, skipped, total, errors}
    """
    user = g.current_user
    if not user.odoo_access_token:
        return jsonify(
            {'error': 'No Odoo access token. Please re-login.'}), 401

    odoo_base = current_app.config['ODOO_BASE_URL'].rstrip('/')
    centre_id = current_app.config['ODOO_CENTRE_ID']
    data_dir = current_app.config['FACE_DATA_DIR']
    known_faces_dir = os.path.join(data_dir, 'known_faces')
    os.makedirs(known_faces_dir, exist_ok=True)

    app = current_app._get_current_object()

    thread = threading.Thread(
        target=_run_sync_background,
        args=(app, odoo_base, centre_id, user.odoo_access_token,
              known_faces_dir),
        daemon=True,
    )
    thread.start()

    return jsonify({'status': 'started'})
