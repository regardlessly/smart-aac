from flask import Blueprint, current_app, g, jsonify, request
import requests as http_requests

from .auth import login_required

bp = Blueprint('activities', __name__)


@bp.route('/api/activities')
@login_required
def list_activities():
    """Proxy to Odoo aac_activities endpoint, or serve from local DB in dev."""
    import os
    from ..models.activity import Activity

    user = g.current_user
    access_token = user.odoo_access_token

    # Dev/offline fallback: serve from local DB when no Odoo token
    if not access_token and os.environ.get('FLASK_ENV') == 'development':
        activities = Activity.query.order_by(Activity.scheduled_time).all()
        return jsonify({'activities': [a.to_dict() for a in activities]})

    if not access_token:
        return jsonify({'error': 'No Odoo access token. Please re-login.'}), 403

    period = request.args.get('period', 'today')
    from .app_config import get_odoo_config
    odoo_cfg = get_odoo_config()
    odoo_base = odoo_cfg['odoo_base_url'].rstrip('/')
    centre_id = odoo_cfg['odoo_centre_id']

    try:
        resp = http_requests.get(
            f'{odoo_base}/centre_ops/aac_activities',
            params={
                'period': period,
                'centre_id': centre_id,
            },
            headers={'access-token': access_token},
            timeout=15,
        )
    except http_requests.RequestException as e:
        current_app.logger.error(f'Odoo aac_activities request failed: {e}')
        return jsonify({'error': 'Activity service unavailable'}), 503

    if resp.status_code != 200:
        current_app.logger.error(
            f'Odoo aac_activities returned {resp.status_code}: {resp.text[:1000]}')
        return jsonify({'error': f'Odoo API error ({resp.status_code})'}), 502

    data = resp.json()
    # Odoo wraps in {"result": ...}
    result = data.get('result', data)

    return jsonify(result)
