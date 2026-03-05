from flask import Blueprint, current_app, g, jsonify, request
import requests as http_requests

from .auth import login_required

bp = Blueprint('activities', __name__)


@bp.route('/api/activities')
@login_required
def list_activities():
    """Proxy to Odoo aac_activities endpoint."""
    period = request.args.get('period', 'today')

    user = g.current_user
    access_token = user.odoo_access_token
    if not access_token:
        return jsonify({'error': 'No Odoo access token. Please re-login.'}), 401

    odoo_base = current_app.config['ODOO_BASE_URL'].rstrip('/')
    centre_id = current_app.config['ODOO_CENTRE_ID']

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
