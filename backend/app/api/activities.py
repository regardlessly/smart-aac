from flask import Blueprint, jsonify, request
from datetime import date, datetime

from ..models.activity import Activity

bp = Blueprint('activities', __name__)


@bp.route('/api/activities')
def list_activities():
    date_filter = request.args.get('date')
    status_filter = request.args.get('status')

    query = Activity.query

    if date_filter == 'today' or date_filter is None:
        today_start = datetime.combine(date.today(), datetime.min.time())
        today_end = datetime.combine(date.today(), datetime.max.time())
        query = query.filter(
            Activity.scheduled_time >= today_start,
            Activity.scheduled_time <= today_end,
        )
    elif date_filter:
        try:
            d = date.fromisoformat(date_filter)
            day_start = datetime.combine(d, datetime.min.time())
            day_end = datetime.combine(d, datetime.max.time())
            query = query.filter(
                Activity.scheduled_time >= day_start,
                Activity.scheduled_time <= day_end,
            )
        except ValueError:
            pass

    if status_filter:
        query = query.filter_by(status=status_filter)

    activities = query.order_by(Activity.scheduled_time).all()
    return jsonify([a.to_dict() for a in activities])
