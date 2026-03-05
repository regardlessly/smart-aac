"""Admin endpoints for daily presence summary management.

Provides:
- Manual trigger for daily summary generation
- Backfill for historical dates
- View CCTV/scheduler configuration
- View summary statistics
"""

from datetime import date, datetime

from flask import Blueprint, current_app, jsonify, request

from ..extensions import db
from ..models.senior import DailyPresenceSummary
from .auth import login_required

bp = Blueprint('summary', __name__)


@bp.route('/api/admin/summary/config')
@login_required
def summary_config():
    """Return current CCTV and scheduler configuration."""
    return jsonify({
        'cctv_start_hour': current_app.config.get('CCTV_START_HOUR', 7),
        'cctv_end_hour': current_app.config.get('CCTV_END_HOUR', 22),
        'daily_report_hour': current_app.config.get('DAILY_REPORT_HOUR', 22),
        'daily_report_minute': current_app.config.get(
            'DAILY_REPORT_MINUTE', 5),
    })


@bp.route('/api/admin/summary/stats')
@login_required
def summary_stats():
    """Return summary statistics."""
    from sqlalchemy import func

    total = DailyPresenceSummary.query.count()
    latest = db.session.query(
        func.max(DailyPresenceSummary.date)
    ).scalar()
    earliest = db.session.query(
        func.min(DailyPresenceSummary.date)
    ).scalar()
    unique_dates = db.session.query(
        func.count(func.distinct(DailyPresenceSummary.date))
    ).scalar()
    unique_seniors = db.session.query(
        func.count(func.distinct(DailyPresenceSummary.senior_id))
    ).scalar()

    return jsonify({
        'total_records': total,
        'earliest_date': earliest.isoformat() if earliest else None,
        'latest_date': latest.isoformat() if latest else None,
        'unique_dates': unique_dates,
        'unique_seniors': unique_seniors,
    })


@bp.route('/api/admin/summary/generate', methods=['POST'])
@login_required
def generate_summary():
    """Manually trigger daily summary for a specific date.

    JSON body:
        date – 'YYYY-MM-DD' (default: today)
    """
    from ..services.daily_summary_service import DailySummaryService

    body = request.get_json(silent=True) or {}
    date_str = body.get('date')

    if date_str:
        try:
            target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
    else:
        target_date = date.today()

    cctv_start = current_app.config.get('CCTV_START_HOUR', 7)
    cctv_end = current_app.config.get('CCTV_END_HOUR', 22)

    result = DailySummaryService.run_daily_summary(
        target_date=target_date,
        cctv_start_hour=cctv_start,
        cctv_end_hour=cctv_end,
    )

    return jsonify(result)


@bp.route('/api/admin/summary/backfill', methods=['POST'])
@login_required
def backfill_summaries():
    """Backfill daily summaries for a range of dates.

    JSON body:
        start_date – 'YYYY-MM-DD' (required)
        end_date   – 'YYYY-MM-DD' (default: today)
    """
    from ..services.daily_summary_service import DailySummaryService

    body = request.get_json(silent=True) or {}

    start_str = body.get('start_date')
    if not start_str:
        return jsonify({'error': 'start_date is required'}), 400

    try:
        start_date = datetime.strptime(start_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'Invalid start_date format'}), 400

    end_str = body.get('end_date')
    if end_str:
        try:
            end_date = datetime.strptime(end_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Invalid end_date format'}), 400
    else:
        end_date = date.today()

    cctv_start = current_app.config.get('CCTV_START_HOUR', 7)
    cctv_end = current_app.config.get('CCTV_END_HOUR', 22)

    results = DailySummaryService.backfill(
        start_date=start_date,
        end_date=end_date,
        cctv_start_hour=cctv_start,
        cctv_end_hour=cctv_end,
    )

    return jsonify({
        'days_processed': len(results),
        'results': results,
    })
