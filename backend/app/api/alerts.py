from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models.alert import Alert

bp = Blueprint('alerts', __name__)


@bp.route('/api/alerts')
def list_alerts():
    acknowledged = request.args.get('acknowledged')
    alert_type = request.args.get('type')

    query = Alert.query

    if acknowledged is not None:
        query = query.filter_by(
            acknowledged=acknowledged.lower() == 'true')

    if alert_type:
        query = query.filter_by(type=alert_type)

    alerts = query.order_by(Alert.created_at.desc()).all()
    return jsonify([a.to_dict() for a in alerts])


@bp.route('/api/alerts/count')
def alert_count():
    total = Alert.query.filter_by(acknowledged=False).count()
    critical = Alert.query.filter_by(
        acknowledged=False, type='critical').count()
    warning = Alert.query.filter_by(
        acknowledged=False, type='warning').count()
    info = Alert.query.filter_by(
        acknowledged=False, type='info').count()

    return jsonify({
        'total': total,
        'critical': critical,
        'warning': warning,
        'info': info,
    })


@bp.route('/api/alerts/<int:alert_id>/acknowledge', methods=['PUT'])
def acknowledge_alert(alert_id):
    alert = Alert.query.get_or_404(alert_id)
    alert.acknowledged = True
    db.session.commit()
    return jsonify(alert.to_dict())
