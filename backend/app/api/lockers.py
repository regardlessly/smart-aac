from flask import Blueprint, jsonify

from ..models.locker import Locker
from .auth import login_required

bp = Blueprint('lockers', __name__)


@bp.route('/api/lockers')
@login_required
def list_lockers():
    lockers = Locker.query.order_by(Locker.locker_number).all()
    return jsonify([l.to_dict() for l in lockers])
