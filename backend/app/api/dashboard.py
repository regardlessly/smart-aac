from flask import Blueprint, current_app, g, jsonify
from sqlalchemy import func
from datetime import date, datetime, timezone

import requests as http_requests

from ..extensions import db
from ..models.senior import Senior
from ..models.room import Room
from ..models.alert import Alert
from .auth import login_required

bp = Blueprint('dashboard', __name__)


@bp.route('/api/dashboard')
@login_required
def get_dashboard():
    today_start = datetime.combine(date.today(), datetime.min.time())

    import json as _json
    from ..models.camera import Camera, CCTVSnapshot

    # Use latest snapshot per camera — same source as CCTV feed page
    latest_snap = db.session.query(
        CCTVSnapshot.camera_id,
        func.max(CCTVSnapshot.id).label('max_id'),
    ).group_by(CCTVSnapshot.camera_id).subquery()

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

    # Compute totals with cross-camera stranger adjustment
    identified = sum(len(s) for s in room_all_names.values())
    unidentified = 0
    room_strangers: dict[int, int] = {}
    for room_id, cam_list in room_camera_data.items():
        all_names = room_all_names.get(room_id, set())
        best = 0
        for cam_names, cam_strangers in cam_list:
            identified_elsewhere = len(all_names - cam_names)
            adjusted = max(0, cam_strangers - identified_elsewhere)
            best = max(best, adjusted)
        room_strangers[room_id] = best
        unidentified += best
    seniors_present = identified + unidentified

    # Active rooms = rooms with any people
    total_rooms = Room.query.count()
    active_rooms = sum(
        1 for rid in room_all_names
        if len(room_all_names[rid]) + room_strangers.get(rid, 0) > 0
    )

    # Today's activities — fetch from Odoo
    todays_activities = 0
    user = g.current_user
    if user and user.odoo_access_token:
        try:
            from .app_config import get_odoo_config
            odoo_cfg = get_odoo_config()
            odoo_base = odoo_cfg['odoo_base_url'].rstrip('/')
            centre_id = odoo_cfg['odoo_centre_id']
            resp = http_requests.get(
                f'{odoo_base}/centre_ops/aac_activities',
                params={'period': 'today', 'centre_id': centre_id},
                headers={'access-token': user.odoo_access_token},
                timeout=5,
            )
            if resp.status_code == 200:
                data = resp.json()
                result = data.get('result', data)
                if isinstance(result, list):
                    todays_activities = len(result)
                elif isinstance(result, dict) and 'activities' in result:
                    todays_activities = len(result['activities'])
        except Exception:
            pass

    # Active alerts
    alert_count = Alert.query.filter_by(acknowledged=False).count()

    # Total registered seniors
    total_seniors = Senior.query.filter_by(is_active=True).count()

    return jsonify({
        'seniors_present': seniors_present,
        'seniors_max': total_seniors,
        'unidentified_count': unidentified,
        'active_rooms': {
            'count': active_rooms,
            'total': total_rooms,
        },
        'todays_activities': todays_activities,
        'alert_count': alert_count,
        'last_sync': datetime.now(timezone.utc).isoformat(),
    })


@bp.route('/api/health')
def health():
    try:
        db.session.execute(db.text('SELECT 1'))
        db_status = 'connected'
    except Exception:
        db_status = 'disconnected'

    return jsonify({
        'status': 'ok',
        'db': db_status,
    })
