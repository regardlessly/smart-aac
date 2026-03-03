from flask import Blueprint, jsonify, request
from datetime import date, datetime

from ..models.kiosk_event import KioskEvent
from .auth import login_required

bp = Blueprint('kiosk_events', __name__)


@bp.route('/api/kiosk-events')
@login_required
def list_kiosk_events():
    date_filter = request.args.get('date')
    limit = request.args.get('limit', 50, type=int)

    query = KioskEvent.query

    if date_filter == 'today' or date_filter is None:
        today_start = datetime.combine(date.today(), datetime.min.time())
        query = query.filter(KioskEvent.timestamp >= today_start)
    elif date_filter:
        try:
            d = date.fromisoformat(date_filter)
            day_start = datetime.combine(d, datetime.min.time())
            day_end = datetime.combine(d, datetime.max.time())
            query = query.filter(
                KioskEvent.timestamp >= day_start,
                KioskEvent.timestamp <= day_end,
            )
        except ValueError:
            pass

    events = query.order_by(
        KioskEvent.timestamp.desc()).limit(limit).all()
    return jsonify([e.to_dict() for e in events])
