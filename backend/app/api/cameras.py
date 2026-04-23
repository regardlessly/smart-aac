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

    # known_faces stores flat files: Name.jpg, Name_N.jpg, Name_auto_*.jpg
    # Use get_person_name() to strip numeric suffixes and descriptors
    from ..lib.face_recognizer import get_person_name
    person_counts = {}
    if os.path.isdir(known_dir):
        for fname in sorted(os.listdir(known_dir)):
            if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            # Proper name extraction (strips _N and _auto_ suffixes)
            person = get_person_name(fname).replace(' ', '_')
            person_counts[person] = person_counts.get(person, 0) + 1

    # Get embedding counts from the running face engine
    embedding_counts = {}
    try:
        from ..services.face_recognition_service import FaceRecognitionService
        with FaceRecognitionService._lock:
            if FaceRecognitionService._instance:
                engine = FaceRecognitionService._instance._engine
                if engine:
                    for name, _ in engine.known_embeddings:
                        safe = name.replace(' ', '_')
                        embedding_counts[safe] = embedding_counts.get(safe, 0) + 1
    except Exception:
        pass

    faces = [{'name': name, 'image_count': count,
              'embedding_count': embedding_counts.get(name, 0)}
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


def _is_placeholder_image(profile_image, image_bytes=None):
    """Check if the profile image is a default Odoo placeholder/avatar.

    Two-stage check:
      1. URL-based heuristics (no download needed)
      2. Content-based: Odoo's default avatar is exactly 6078 bytes.
         If image_bytes are provided, check the size.
    """
    if not profile_image:
        return True
    pi = profile_image.strip().lower()
    # Common Odoo static placeholder paths
    if any(s in pi for s in (
        '/web/static/img/user_icon',
        '/web/static/img/placeholder',
        'avatar_grey',
        'default_image',
    )):
        return True
    # Very short base64 strings are likely 1x1 pixel placeholders
    if pi.startswith('data:image/') and len(pi) < 200:
        return True
    # Content check: Odoo default avatar is exactly 6078 bytes
    if image_bytes is not None and len(image_bytes) == 6078:
        return True
    return False


# Sync metadata file tracks write_date per member so unchanged profiles are
# skipped without downloading the image at all.
_SYNC_META_FILE = '.sync_meta.json'


def _load_sync_meta(known_faces_dir):
    """Load {name: write_date} from the sync metadata file."""
    import json
    meta_path = os.path.join(known_faces_dir, _SYNC_META_FILE)
    if os.path.exists(meta_path):
        try:
            with open(meta_path, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_sync_meta(known_faces_dir, meta):
    """Persist the sync metadata file."""
    import json
    meta_path = os.path.join(known_faces_dir, _SYNC_META_FILE)
    with open(meta_path, 'w') as f:
        json.dump(meta, f)


def _download_member_face(member, odoo_base, known_faces_dir, sync_meta):
    """Download a single member's profile image. Returns (name, status, err).

    Incremental logic (no unnecessary downloads):
      1. Skip if profileImage is a placeholder / missing
      2. Skip if member's write_date hasn't changed since last sync
      3. Otherwise download, save, and update sync_meta
    sync_meta is keyed by Odoo member ID so name changes are handled.
    """
    odoo_mid = str(member.get('id', ''))
    name = (member.get('name') or '').strip()
    profile_image = member.get('profileImage')
    write_date = member.get('write_date') or member.get('__last_update') or ''

    if not name:
        return (name or '?', 'skipped', None)

    # Skip obvious placeholders before downloading
    if _is_placeholder_image(profile_image):
        return (name, 'skipped', None)

    try:
        safe_name = name.replace(' ', '_')
        meta_key = odoo_mid or name  # Use Odoo ID as key, fall back to name
        prev_meta = sync_meta.get(meta_key, {}) if isinstance(sync_meta.get(meta_key), dict) else {}
        prev_write_date = prev_meta.get('write_date', sync_meta.get(meta_key, '')) if not isinstance(sync_meta.get(meta_key), dict) else prev_meta.get('write_date', '')
        prev_name = prev_meta.get('name', '')

        # Find existing files — check both current name and previous name
        existing = [f for f in os.listdir(known_faces_dir)
                    if f.lower().startswith(safe_name.lower())
                    and f.lower().endswith(('.jpg', '.jpeg', '.png'))]

        # If name changed, also look for files under the old name
        old_name_files = []
        if prev_name and prev_name != name:
            old_safe = prev_name.replace(' ', '_')
            old_name_files = [f for f in os.listdir(known_faces_dir)
                              if f.lower().startswith(old_safe.lower())
                              and f.lower().endswith(('.jpg', '.jpeg', '.png'))]

        # Skip if write_date unchanged AND local file exists
        if existing and write_date and prev_write_date == write_date and not old_name_files:
            return (name, 'skipped', None)

        resolved = _resolve_profile_image(profile_image, odoo_base)
        if resolved is None:
            return (name, 'skipped', None)

        ext, image_bytes = resolved

        # Skip if downloaded image is a placeholder (e.g. Odoo 6078-byte default)
        if _is_placeholder_image(profile_image, image_bytes):
            if write_date:
                sync_meta[meta_key] = {'write_date': write_date, 'name': name}
            return (name, 'skipped', None)

        # Remove old images (current name + old name if renamed)
        for old_file in existing + old_name_files:
            path = os.path.join(known_faces_dir, old_file)
            if os.path.exists(path):
                os.remove(path)

        filename = f'{safe_name}.{ext}'
        dest = os.path.join(known_faces_dir, filename)
        with open(dest, 'wb') as f:
            f.write(image_bytes)

        # Record write_date + name so next sync can detect name changes
        if write_date:
            sync_meta[meta_key] = {'write_date': write_date, 'name': name}

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

        # Filter members based on sync config (all vs selected)
        from ..models.app_config import AppConfig
        sync_mode = AppConfig.get('sync_mode', 'all')
        if sync_mode == 'selected':
            raw_ids = AppConfig.get('sync_selected_ids', '')
            selected = {s.strip() for s in raw_ids.split(',') if s.strip()}
            if selected:
                all_members = [
                    m for m in all_members
                    if str(m.get('id', '')) in selected
                ]

        total = len(all_members)

        # Phase 1.5: Upsert Senior records in the database
        # Match priority: odoo_id > name (case-insensitive)
        # Deactivate seniors not in Odoo, clean up duplicates.
        from ..models.senior import Senior

        all_seniors = Senior.query.all()
        by_odoo_id = {s.odoo_id: s for s in all_seniors if s.odoo_id}
        by_name_lower = {}
        for s in all_seniors:
            key = s.name.strip().lower()
            # Keep the one with odoo_id, or the first one
            if key not in by_name_lower or (s.odoo_id and not by_name_lower[key].odoo_id):
                by_name_lower[key] = s

        seen_odoo_ids = set()
        for m in all_members:
            odoo_mid = str(m.get('id', ''))
            name = (m.get('name') or '').strip()
            nric = (m.get('nricFin') or '')[-4:] or '????'
            if not name:
                continue

            # Match by Odoo ID first, then by name (case-insensitive)
            senior = by_odoo_id.get(odoo_mid)
            if senior is None:
                senior = by_name_lower.get(name.lower())

            if senior:
                senior.name = name
                senior.nric_last4 = nric
                senior.odoo_id = odoo_mid
                senior.is_active = True
            else:
                senior = Senior(
                    odoo_id=odoo_mid, name=name,
                    nric_last4=nric, is_active=True,
                )
                db.session.add(senior)

            seen_odoo_ids.add(odoo_mid)

        # Clean up: delete seniors without odoo_id (stale seed data or
        # orphans from name changes). Only after a successful full sync.
        if seen_odoo_ids:
            for s in all_seniors:
                if not s.odoo_id:
                    db.session.delete(s)
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()

        push_event({
            'type': 'sync_progress',
            'phase': 'downloading',
            'synced': 0,
            'skipped': 0,
            'total': total,
            'name': '',
        })

        # Phase 2: Download images concurrently (8 workers)
        sync_meta = _load_sync_meta(known_faces_dir)
        synced = 0
        skipped = 0
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(
                    _download_member_face, m, odoo_base, known_faces_dir,
                    sync_meta,
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

        # Persist sync metadata so next run can skip unchanged members
        _save_sync_meta(known_faces_dir, sync_meta)

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


# ---------------------------------------------------------------------------
# CCTV Face Enrollment
# ---------------------------------------------------------------------------

@bp.route('/api/cameras/enrollment/prewarm', methods=['POST'])
@login_required
def enrollment_prewarm():
    """Pre-open RTSP connection for a camera without starting full enrollment.
    Call this as soon as user selects a camera in the modal."""
    from ..services.face_recognition_service import FaceRecognitionService

    data = request.get_json() or {}
    camera_id = data.get('camera_id')
    if not camera_id:
        return jsonify({'error': 'camera_id required'}), 400

    camera = db.session.get(Camera, camera_id)
    if not camera or not camera.rtsp_url:
        return jsonify({'error': 'Camera not found'}), 404

    result = FaceRecognitionService.prewarm_rtsp(camera.name, camera.rtsp_url)
    return jsonify(result)


@bp.route('/api/cameras/enrollment/start', methods=['POST'])
@login_required
def enrollment_start():
    """Start a MANUAL face enrollment session — opens RTSP, waits for capture calls."""
    from ..services.face_recognition_service import FaceRecognitionService

    data = request.get_json() or {}
    camera_id = data.get('camera_id')
    person_name = (data.get('person_name') or '').strip()

    if not camera_id or not person_name:
        return jsonify({'error': 'camera_id and person_name required'}), 400

    camera = db.session.get(Camera, camera_id)
    if not camera or not camera.rtsp_url:
        return jsonify({'error': 'Camera not found or no RTSP URL'}), 404

    result = FaceRecognitionService.start_manual_enrollment(
        camera.name, person_name, camera.rtsp_url)

    if 'error' in result:
        return jsonify(result), 409

    return jsonify(result)


@bp.route('/api/cameras/enrollment/capture', methods=['POST'])
@login_required
def enrollment_capture():
    """Capture one face from the active enrollment session."""
    from ..services.face_recognition_service import FaceRecognitionService
    result = FaceRecognitionService.manual_capture_one()
    if 'error' in result:
        return jsonify(result), 400
    return jsonify(result)


@bp.route('/api/cameras/enrollment/finish', methods=['POST'])
@login_required
def enrollment_finish():
    """Save captured crops and close the enrollment session."""
    from ..services.face_recognition_service import FaceRecognitionService
    data = request.get_json() or {}
    keep_indices = data.get('keep_indices')  # optional list
    result = FaceRecognitionService.finish_manual_enrollment(keep_indices)
    if 'error' in result:
        return jsonify(result), 400
    return jsonify(result)


@bp.route('/api/cameras/enrollment/cancel', methods=['POST'])
@login_required
def enrollment_cancel():
    """Cancel an active enrollment session."""
    from ..services.face_recognition_service import FaceRecognitionService
    return jsonify(FaceRecognitionService.cancel_enrollment())


@bp.route('/api/cameras/enrollment/status')
@login_required
def enrollment_status():
    """Return current enrollment state."""
    from ..services.face_recognition_service import FaceRecognitionService
    return jsonify(FaceRecognitionService.get_enrollment_status())


@bp.route('/api/cameras/known-faces/sync-odoo', methods=['POST'])
@login_required
def sync_known_faces_from_odoo():
    """Start syncing known faces from Odoo member profiles (background).

    Returns immediately. Progress is pushed via SSE events:
      - sync_progress: {phase, synced, skipped, total, name}
      - sync_complete: {synced, skipped, total, errors}
    """
    import os as _os
    from ..models.user import User

    user = g.current_user
    access_token = user.odoo_access_token

    # In dev mode, fall back to any available Odoo token (e.g. from a
    # previous Odoo login session) so sync works without re-authenticating.
    if not access_token and _os.environ.get('FLASK_ENV') == 'development':
        other = User.query.filter(
            User.odoo_access_token.isnot(None),
            User.odoo_access_token != '',
        ).first()
        if other:
            access_token = other.odoo_access_token

    if not access_token:
        return jsonify(
            {'error': 'No Odoo access token. Please log in with Odoo credentials first.'}), 403

    from .app_config import get_odoo_config
    odoo_cfg = get_odoo_config()
    odoo_base = odoo_cfg['odoo_base_url'].rstrip('/')
    centre_id = odoo_cfg['odoo_centre_id']
    data_dir = current_app.config['FACE_DATA_DIR']
    known_faces_dir = os.path.join(data_dir, 'known_faces')
    os.makedirs(known_faces_dir, exist_ok=True)

    app = current_app._get_current_object()

    thread = threading.Thread(
        target=_run_sync_background,
        args=(app, odoo_base, centre_id, access_token,
              known_faces_dir),
        daemon=True,
    )
    thread.start()

    return jsonify({'status': 'started'})
