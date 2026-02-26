from flask import Blueprint, jsonify
from sqlalchemy import func
from datetime import date, datetime, timezone

from ..extensions import db
from ..models.senior import Senior, SeniorPresence
from ..models.room import Room
from ..models.activity import Activity
from ..models.alert import Alert

bp = Blueprint('dashboard', __name__)


@bp.route('/api/dashboard')
def get_dashboard():
    today_start = datetime.combine(date.today(), datetime.min.time())

    # Seniors present (current presences with identified status)
    identified = SeniorPresence.query.filter_by(
        is_current=True, status='identified').count()
    unidentified = SeniorPresence.query.filter_by(
        is_current=True, status='unidentified').count()
    seniors_present = identified + unidentified

    # Active rooms
    total_rooms = Room.query.count()
    active_rooms = Room.query.filter(Room.current_occupancy > 0).count()

    # Today's activities
    todays_activities = Activity.query.filter(
        Activity.scheduled_time >= today_start
    ).count()

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
