from flask import Blueprint, jsonify, request
from sqlalchemy import case, func
from sqlalchemy.orm import joinedload

from ..extensions import db
from ..models.alert import Alert
from .auth import login_required

bp = Blueprint('alerts', __name__)


@bp.route('/api/alerts')
@login_required
def list_alerts():
    acknowledged = request.args.get('acknowledged')
    alert_type = request.args.get('type')
    search = request.args.get('search', '').strip()
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    per_page = min(per_page, 200)

    query = Alert.query.options(joinedload(Alert.camera))

    if acknowledged is not None:
        query = query.filter_by(
            acknowledged=acknowledged.lower() == 'true')

    if alert_type:
        query = query.filter_by(type=alert_type)

    if search:
        like = f'%{search}%'
        query = query.filter(
            db.or_(Alert.title.ilike(like), Alert.description.ilike(like)))

    total = query.count()
    alerts = (query.order_by(Alert.created_at.desc())
              .offset((page - 1) * per_page)
              .limit(per_page)
              .all())

    return jsonify({
        'alerts': [a.to_dict() for a in alerts],
        'total': total,
        'page': page,
        'per_page': per_page,
        'pages': (total + per_page - 1) // per_page,
    })


@bp.route('/api/alerts/count')
@login_required
def alert_count():
    row = db.session.query(
        func.count().label('total'),
        func.sum(case((Alert.type == 'critical', 1), else_=0)).label(
            'critical'),
        func.sum(case((Alert.type == 'warning', 1), else_=0)).label(
            'warning'),
        func.sum(case((Alert.type == 'info', 1), else_=0)).label(
            'info'),
    ).filter(Alert.acknowledged == False).one()  # noqa: E712

    return jsonify({
        'total': row.total or 0,
        'critical': int(row.critical or 0),
        'warning': int(row.warning or 0),
        'info': int(row.info or 0),
    })


@bp.route('/api/alerts/<int:alert_id>/acknowledge', methods=['PUT'])
@login_required
def acknowledge_alert(alert_id):
    alert = Alert.query.get_or_404(alert_id)
    alert.acknowledged = True
    db.session.commit()
    return jsonify(alert.to_dict())


@bp.route('/api/alerts/bulk-acknowledge', methods=['PUT'])
@login_required
def bulk_acknowledge():
    data = request.get_json(silent=True) or {}
    ids = data.get('ids', [])
    if not ids:
        return jsonify({'acknowledged': 0})
    count = Alert.query.filter(
        Alert.id.in_(ids), Alert.acknowledged == False  # noqa: E712
    ).update({Alert.acknowledged: True}, synchronize_session='fetch')
    db.session.commit()
    return jsonify({'acknowledged': count})
