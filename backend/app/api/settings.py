"""System settings API — read/write runtime configuration."""

from flask import Blueprint, jsonify, request, current_app
from .auth import login_required

bp = Blueprint('settings', __name__)

# Editable settings with their types and defaults
SETTING_DEFS = {
    'FR_CAPTURE_INTERVAL': {'type': int, 'default': 5, 'min': 1, 'max': 300,
                            'label': 'Capture interval (seconds)'},
    'FR_ANALYSE_EVERY':    {'type': int, 'default': 1, 'min': 1, 'max': 20,
                            'label': 'Analyse every N captures'},
    'CCTV_START_HOUR':     {'type': int, 'default': 7, 'min': 0, 'max': 23,
                            'label': 'CCTV start hour'},
    'CCTV_END_HOUR':       {'type': int, 'default': 22, 'min': 0, 'max': 23,
                            'label': 'CCTV end hour'},
}


def _get_settings_from_db():
    """Read persisted settings from the system_settings table."""
    from ..extensions import db
    rows = db.session.execute(
        db.text('SELECT key, value FROM system_settings')
    ).fetchall()
    return {r[0]: r[1] for r in rows}


def _set_setting_in_db(key, value):
    """Upsert a setting into the system_settings table."""
    from ..extensions import db
    db.session.execute(
        db.text(
            'INSERT INTO system_settings (key, value) VALUES (:k, :v) '
            'ON CONFLICT(key) DO UPDATE SET value = :v'
        ),
        {'k': key, 'v': str(value)},
    )
    db.session.commit()


def _ensure_table():
    """Create system_settings table if it doesn't exist."""
    from ..extensions import db
    db.session.execute(db.text(
        'CREATE TABLE IF NOT EXISTS system_settings '
        '(key TEXT PRIMARY KEY, value TEXT NOT NULL)'
    ))
    db.session.commit()


@bp.route('/api/settings', methods=['GET'])
@login_required
def get_settings():
    _ensure_table()
    stored = _get_settings_from_db()
    result = {}
    for key, defn in SETTING_DEFS.items():
        if key in stored:
            result[key] = defn['type'](stored[key])
        else:
            result[key] = current_app.config.get(key, defn['default'])
    return jsonify(result)


@bp.route('/api/settings', methods=['PUT'])
@login_required
def update_settings():
    _ensure_table()
    data = request.get_json(silent=True) or {}
    updated = {}
    errors = {}

    for key, val in data.items():
        if key not in SETTING_DEFS:
            continue
        defn = SETTING_DEFS[key]
        try:
            typed_val = defn['type'](val)
        except (ValueError, TypeError):
            errors[key] = f'Must be {defn["type"].__name__}'
            continue

        if 'min' in defn and typed_val < defn['min']:
            errors[key] = f'Minimum is {defn["min"]}'
            continue
        if 'max' in defn and typed_val > defn['max']:
            errors[key] = f'Maximum is {defn["max"]}'
            continue

        _set_setting_in_db(key, typed_val)
        # Also update the running app config so new camera threads pick it up
        current_app.config[key] = typed_val
        updated[key] = typed_val

    if errors:
        return jsonify({'errors': errors, 'updated': updated}), 400

    return jsonify({'updated': updated, 'restart_required': True})
