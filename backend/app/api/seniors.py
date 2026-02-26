from flask import Blueprint, jsonify, request

from ..models.senior import Senior, SeniorPresence

bp = Blueprint('seniors', __name__)


@bp.route('/api/seniors')
def list_seniors():
    seniors = Senior.query.filter_by(is_active=True).order_by(
        Senior.name).all()
    return jsonify([s.to_dict() for s in seniors])


@bp.route('/api/seniors/<int:senior_id>')
def get_senior(senior_id):
    senior = Senior.query.get_or_404(senior_id)
    return jsonify(senior.to_dict())


@bp.route('/api/seniors/presence')
def list_presence():
    status_filter = request.args.get('status')
    query = SeniorPresence.query.filter_by(is_current=True)

    if status_filter:
        query = query.filter_by(status=status_filter)

    presences = query.order_by(SeniorPresence.arrived_at.desc()).all()
    return jsonify([p.to_dict() for p in presences])
