from datetime import datetime, timezone, timedelta
from functools import wraps

import jwt
import requests as http_requests
from flask import Blueprint, current_app, g, jsonify, request

from ..extensions import db
from ..models.user import User

bp = Blueprint('auth', __name__)


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def _create_token(user: User) -> str:
    payload = {
        'user_id': user.id,
        'odoo_uid': user.odoo_uid,
        'is_manager': user.is_manager,
        'exp': datetime.now(timezone.utc) + timedelta(
            hours=current_app.config['JWT_EXPIRY_HOURS']),
        'iat': datetime.now(timezone.utc),
    }
    return jwt.encode(
        payload,
        current_app.config['JWT_SECRET_KEY'],
        algorithm='HS256',
    )


def _decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(
            token,
            current_app.config['JWT_SECRET_KEY'],
            algorithms=['HS256'],
        )
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


# ---------------------------------------------------------------------------
# @login_required decorator
# ---------------------------------------------------------------------------

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Missing or invalid token'}), 401

        token = auth_header.split(' ', 1)[1]
        payload = _decode_token(token)
        if payload is None:
            return jsonify({'error': 'Token expired or invalid'}), 401

        user = User.query.get(payload.get('user_id'))
        if user is None:
            return jsonify({'error': 'User not found'}), 401

        g.current_user = user
        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

@bp.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    email = data.get('email', '').strip()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400

    # Proxy login to Odoo
    odoo_url = current_app.config['ODOO_BASE_URL'].rstrip('/')
    try:
        resp = http_requests.post(
            f'{odoo_url}/centre_ops/login',
            data={
                'db': current_app.config['ODOO_DB_NAME'],
                'login': email,
                'password': password,
                'centre_id': current_app.config['ODOO_CENTRE_ID'],
            },
            timeout=15,
        )
    except http_requests.RequestException as e:
        current_app.logger.error(f'Odoo login request failed: {e}')
        return jsonify({'error': 'Authentication service unavailable'}), 503

    if resp.status_code != 200:
        return jsonify({'error': 'Invalid credentials'}), 401

    odoo_data = resp.json()

    # Odoo wraps response in {"result": {...}}
    result = odoo_data.get('result', odoo_data)

    # Check for Odoo error — Odoo returns {"type": "...", "message": "..."} on failure
    if result.get('type') or result.get('error') or not result.get('access_token'):
        error_msg = result.get('message') or result.get('error') or 'Invalid credentials'
        return jsonify({'error': error_msg}), 401

    # Upsert local user
    odoo_uid = str(result.get('id', result.get('res_id', '')))
    user = User.query.filter_by(odoo_uid=odoo_uid).first()
    if user is None:
        user = User(odoo_uid=odoo_uid, email=email, name=result.get('name', email))
        db.session.add(user)

    user.name = result.get('name', user.name)
    user.email = email
    user.odoo_access_token = result.get('access_token', '')
    user.is_manager = bool(result.get('isManager', False))
    user.is_volunteer = bool(result.get('isVolunteer', False))
    user.last_login = datetime.now(timezone.utc)
    db.session.commit()

    token = _create_token(user)

    return jsonify({
        'token': token,
        'user': user.to_dict(),
    })


@bp.route('/api/auth/me')
@login_required
def me():
    return jsonify(g.current_user.to_dict())


@bp.route('/api/auth/logout', methods=['POST'])
@login_required
def logout():
    user = g.current_user
    user.odoo_access_token = None
    db.session.commit()
    return jsonify({'status': 'ok'})
