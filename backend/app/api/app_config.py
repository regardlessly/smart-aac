"""API for runtime application configuration (Odoo connection, etc.)."""

from flask import Blueprint, current_app, g, jsonify, request

from .auth import login_required
from ..models.app_config import AppConfig

bp = Blueprint('app_config', __name__)


def get_odoo_config() -> dict:
    """Return current Odoo connection settings, DB overrides first."""
    return {
        'odoo_base_url': AppConfig.get(
            'odoo_base_url',
            current_app.config['ODOO_BASE_URL']),
        'odoo_db_name': AppConfig.get(
            'odoo_db_name',
            current_app.config['ODOO_DB_NAME']),
        'odoo_centre_id': AppConfig.get(
            'odoo_centre_id',
            current_app.config['ODOO_CENTRE_ID']),
    }


@bp.route('/api/config/odoo')
def read_odoo_config():
    """Public — login page needs this before the user has a token."""
    return jsonify(get_odoo_config())


@bp.route('/api/config/odoo', methods=['PUT'])
def update_odoo_config():
    """Update Odoo connection settings.

    No auth required so the login page can set these before the user
    has logged in (initial setup / switching environments).
    """
    data = request.get_json(silent=True) or {}

    allowed = {'odoo_base_url', 'odoo_db_name', 'odoo_centre_id'}
    updated = {}
    for key in allowed:
        if key in data and data[key] is not None:
            val = str(data[key]).strip()
            if val:
                AppConfig.set(key, val)
                updated[key] = val

    if not updated:
        return jsonify({'error': 'No valid fields provided'}), 400

    return jsonify({'status': 'ok', 'updated': updated})


# ---------------------------------------------------------------------------
# Alert settings
# ---------------------------------------------------------------------------

@bp.route('/api/config/alerts')
@login_required
def read_alert_config():
    """Return alert settings."""
    return jsonify({
        'alert_unidentified': AppConfig.get(
            'alert_unidentified', 'true') == 'true',
    })


@bp.route('/api/config/alerts', methods=['PUT'])
@login_required
def update_alert_config():
    """Update alert settings."""
    data = request.get_json(silent=True) or {}

    updated = {}
    if 'alert_unidentified' in data:
        val = 'true' if data['alert_unidentified'] else 'false'
        AppConfig.set('alert_unidentified', val)
        updated['alert_unidentified'] = data['alert_unidentified']

    if not updated:
        return jsonify({'error': 'No valid fields provided'}), 400

    return jsonify({'status': 'ok', 'updated': updated})


# ---------------------------------------------------------------------------
# Sync settings
# ---------------------------------------------------------------------------

@bp.route('/api/config/sync')
@login_required
def read_sync_config():
    """Return sync filter settings."""
    return jsonify({
        'sync_mode': AppConfig.get('sync_mode', 'all'),  # 'all' or 'selected'
        'sync_selected_ids': AppConfig.get('sync_selected_ids', ''),  # comma-delimited Odoo IDs
    })


@bp.route('/api/config/sync', methods=['PUT'])
@login_required
def update_sync_config():
    """Update sync filter settings."""
    data = request.get_json(silent=True) or {}

    updated = {}
    if 'sync_mode' in data and data['sync_mode'] in ('all', 'selected'):
        AppConfig.set('sync_mode', data['sync_mode'])
        updated['sync_mode'] = data['sync_mode']

    if 'sync_selected_ids' in data:
        val = str(data['sync_selected_ids']).strip()
        AppConfig.set('sync_selected_ids', val)
        updated['sync_selected_ids'] = val

    if not updated:
        return jsonify({'error': 'No valid fields provided'}), 400

    return jsonify({'status': 'ok', 'updated': updated})
