from datetime import date, datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from ..extensions import db
from ..models.senior import Senior, SeniorPresence
from ..models.camera import Camera
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

    presences = query.options(
        joinedload(SeniorPresence.senior),
        joinedload(SeniorPresence.room),
    ).order_by(SeniorPresence.arrived_at.desc()).all()
    return jsonify([p.to_dict() for p in presences])


@bp.route('/api/seniors/roster')
@login_required
def roster():
    """Return roster of ALL seniors synced from Odoo with CCTV data.

    Source of members: Senior database table (all synced from Odoo).
    For each senior, look up CCTV presence data (first_seen, last_seen,
    location, camera).
    - Detected + last_seen within 15 min → active
    - Detected + last_seen over 15 min → inactive
    - Never detected → inactive, all fields blank
    """
    ACTIVE_THRESHOLD = 15 * 60  # 15 minutes in seconds

    # 1. Get all seniors from the database (synced from Odoo)
    seniors = Senior.query.order_by(Senior.name).all()

    if not seniors:
        return jsonify([])

    senior_ids = [s.id for s in seniors]

    # 3. Aggregated CCTV times per identified senior — today only
    presence_map: dict[int, dict] = {}
    room_map: dict[int, str | None] = {}
    camera_map: dict[int, str | None] = {}

    # Compute today's time window
    cctv_start = current_app.config.get('CCTV_START_HOUR', 7)
    local_tz = datetime.now(timezone.utc).astimezone().tzinfo
    today = date.today()
    today_start = datetime(
        today.year, today.month, today.day, cctv_start, tzinfo=local_tz
    ).astimezone(timezone.utc).replace(tzinfo=None)

    if senior_ids:
        agg = db.session.query(
            SeniorPresence.senior_id,
            func.min(SeniorPresence.arrived_at).label('first_seen'),
            func.max(SeniorPresence.last_seen_at).label('last_seen'),
        ).filter(
            SeniorPresence.senior_id.in_(senior_ids),
            SeniorPresence.status == 'identified',
            SeniorPresence.arrived_at >= today_start,
        ).group_by(SeniorPresence.senior_id).all()

        for row in agg:
            presence_map[row.senior_id] = {
                'first_seen': row.first_seen,
                'last_seen': row.last_seen,
            }

        # Most recent presence per senior (for room/camera) — today only
        if presence_map:
            latest_sub = db.session.query(
                SeniorPresence.senior_id,
                func.max(SeniorPresence.id).label('max_id'),
            ).filter(
                SeniorPresence.senior_id.in_(list(presence_map.keys())),
                SeniorPresence.status == 'identified',
                SeniorPresence.arrived_at >= today_start,
            ).group_by(SeniorPresence.senior_id).subquery()

            latest_presences = db.session.query(SeniorPresence).options(
                joinedload(SeniorPresence.room),
                joinedload(SeniorPresence.camera).joinedload(Camera.room),
            ).join(
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

    # 4. Build result for every senior in the database
    now = datetime.utcnow()
    result = []
    for senior in seniors:
        pdata = presence_map.get(senior.id)

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
            'name': senior.name,
            'senior_id': senior.id,
            'first_seen': (first_seen.isoformat() + 'Z')
            if first_seen else None,
            'last_seen': (last_seen.isoformat() + 'Z')
            if last_seen else None,
            'status': status,
            'location': room_map.get(senior.id) if pdata else None,
            'camera_location': (camera_map.get(senior.id)
                                if pdata else None),
        })

    # Sort: active first, then inactive; within each group by last_seen desc, then name
    active = [r for r in result if r['status'] == 'active']
    inactive = [r for r in result if r['status'] == 'inactive']

    active.sort(key=lambda r: r['last_seen'] or '', reverse=True)
    inactive.sort(key=lambda r: (r['last_seen'] or '', r['name']), reverse=True)

    return jsonify(active + inactive)
