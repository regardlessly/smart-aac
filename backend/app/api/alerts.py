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
    limit = request.args.get('limit', 200, type=int)

    query = Alert.query.options(joinedload(Alert.camera))

    if acknowledged is not None:
        query = query.filter_by(
            acknowledged=acknowledged.lower() == 'true')

    if alert_type:
        query = query.filter_by(type=alert_type)

    alerts = query.order_by(Alert.created_at.desc()).limit(limit).all()
    return jsonify([a.to_dict() for a in alerts])


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
