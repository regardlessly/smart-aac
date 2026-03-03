import os
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import func

from ..extensions import db
from ..lib.face_recognizer import get_person_name
from ..models.senior import Senior, SeniorPresence
from .auth import login_required

bp = Blueprint('seniors', __name__)


@bp.route('/api/seniors')
@login_required
def list_seniors():
    seniors = Senior.query.filter_by(is_active=True).order_by(
        Senior.name).all()
    return jsonify([s.to_dict() for s in seniors])


@bp.route('/api/seniors/<int:senior_id>')
@login_required
def get_senior(senior_id):
    senior = Senior.query.get_or_404(senior_id)
    return jsonify(senior.to_dict())


@bp.route('/api/seniors/presence')
@login_required
def list_presence():
    status_filter = request.args.get('status')
    query = SeniorPresence.query.filter_by(is_current=True)

    if status_filter:
        query = query.filter_by(status=status_filter)

    presences = query.order_by(SeniorPresence.arrived_at.desc()).all()
    return jsonify([p.to_dict() for p in presences])


@bp.route('/api/seniors/roster')
@login_required
def roster():
    """Return roster of ALL known faces (synced from Odoo) with CCTV data.

    Source of members: known_faces/ directory (Odoo sync).
    For each known face, look up matching Senior record to get CCTV
    presence data (first_seen, last_seen, location, camera).
    - Detected + last_seen within 15 min → active
    - Detected + last_seen over 15 min → inactive
    - Never detected → inactive, all fields blank
    """
    ACTIVE_THRESHOLD = 15 * 60  # 15 minutes in seconds

    # 1. Get all known face names from known_faces/ directory
    #    Use get_person_name() so names match what the face recognizer
    #    produces (e.g. "ADRIAN_WONGGG.jpg" → "ADRIAN WONGGG").
    data_dir = current_app.config['FACE_DATA_DIR']
    known_dir = os.path.join(data_dir, 'known_faces')
    known_names: set[str] = set()
    if os.path.isdir(known_dir):
        for fname in os.listdir(known_dir):
            if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            known_names.add(get_person_name(fname))

    if not known_names:
        return jsonify([])

    # 2. Match names to Senior records (for presence data linkage)
    seniors = Senior.query.filter(
        Senior.name.in_(known_names), Senior.is_active.is_(True)
    ).all()
    senior_by_name: dict[str, Senior] = {s.name: s for s in seniors}
    senior_ids = [s.id for s in seniors]

    # 3. Aggregated CCTV times per identified senior
    presence_map: dict[int, dict] = {}
    room_map: dict[int, str | None] = {}
    camera_map: dict[int, str | None] = {}

    if senior_ids:
        agg = db.session.query(
            SeniorPresence.senior_id,
            func.min(SeniorPresence.arrived_at).label('first_seen'),
            func.max(SeniorPresence.last_seen_at).label('last_seen'),
        ).filter(
            SeniorPresence.senior_id.in_(senior_ids),
            SeniorPresence.status == 'identified',
        ).group_by(SeniorPresence.senior_id).all()

        for row in agg:
            presence_map[row.senior_id] = {
                'first_seen': row.first_seen,
                'last_seen': row.last_seen,
            }

        # Most recent presence per senior (for room/camera)
        if presence_map:
            latest_sub = db.session.query(
                SeniorPresence.senior_id,
                func.max(SeniorPresence.id).label('max_id'),
            ).filter(
                SeniorPresence.senior_id.in_(list(presence_map.keys())),
                SeniorPresence.status == 'identified',
            ).group_by(SeniorPresence.senior_id).subquery()

            latest_presences = db.session.query(SeniorPresence).join(
                latest_sub, SeniorPresence.id == latest_sub.c.max_id
            ).all()

            for p in latest_presences:
                room_map[p.senior_id] = p.room.name if p.room else None
                cam = p.camera
                # Prefer room name from camera's linked room
                if not room_map.get(p.senior_id) and cam and cam.room:
                    room_map[p.senior_id] = cam.room.name
                camera_map[p.senior_id] = (
                    (cam.location or cam.name) if cam else None
                )

    # 4. Build result for every known face
    now = datetime.utcnow()
    result = []
    for name in known_names:
        senior = senior_by_name.get(name)
        pdata = presence_map.get(senior.id) if senior else None

        if pdata:
            first_seen = pdata['first_seen']
            last_seen = pdata['last_seen']
            elapsed = (now - last_seen).total_seconds() if last_seen else None
            status = ('active'
                      if elapsed is not None and elapsed <= ACTIVE_THRESHOLD
                      else 'inactive')
        else:
            first_seen = None
            last_seen = None
            status = 'inactive'

        result.append({
            'name': name,
            'senior_id': senior.id if senior else None,
            'first_seen': (first_seen.isoformat() + 'Z')
            if first_seen else None,
            'last_seen': (last_seen.isoformat() + 'Z')
            if last_seen else None,
            'status': status,
            'location': room_map.get(senior.id) if senior and pdata else None,
            'camera_location': (camera_map.get(senior.id)
                                if senior and pdata else None),
        })

    # Sort: active first, then inactive-with-detections, then never-detected
    active = [r for r in result if r['status'] == 'active']
    detected_inactive = [r for r in result
                         if r['status'] == 'inactive' and r['last_seen']]
    never_detected = [r for r in result
                      if r['status'] == 'inactive' and not r['last_seen']]

    active.sort(key=lambda r: r['last_seen'] or '', reverse=True)
    detected_inactive.sort(key=lambda r: r['last_seen'] or '', reverse=True)
    never_detected.sort(key=lambda r: r['name'].lower())

    return jsonify(active + detected_inactive + never_detected)
