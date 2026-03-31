"""System log API — streams backend log file to the frontend."""

import os
from flask import Blueprint, jsonify, request
from .auth import login_required

bp = Blueprint('logs', __name__)

BACKEND_LOG = '/tmp/smart-aac-backend.log'
FRONTEND_LOG = '/tmp/smart-aac-frontend.log'


def _read_log(path: str, lines: int = 200) -> list[str]:
    """Read last N lines from a log file."""
    if not os.path.exists(path):
        return []
    try:
        with open(path, 'r', errors='replace') as f:
            all_lines = f.readlines()
        return [l.rstrip('\n') for l in all_lines[-lines:]]
    except Exception as e:
        return [f'[Error reading log: {e}]']


def _strip_ansi(text: str) -> str:
    """Remove ANSI color codes from log lines."""
    import re
    return re.sub(r'\x1b\[[0-9;]*m', '', text)


@bp.route('/api/logs/backend')
@login_required
def backend_log():
    lines = min(int(request.args.get('lines', 200)), 1000)
    raw = _read_log(BACKEND_LOG, lines)
    cleaned = [_strip_ansi(l) for l in raw]
    return jsonify({'lines': cleaned, 'path': BACKEND_LOG})


@bp.route('/api/logs/frontend')
@login_required
def frontend_log():
    lines = min(int(request.args.get('lines', 200)), 1000)
    raw = _read_log(FRONTEND_LOG, lines)
    cleaned = [_strip_ansi(l) for l in raw]
    return jsonify({'lines': cleaned, 'path': FRONTEND_LOG})


@bp.route('/api/logs/camera-status')
@login_required
def camera_status():
    """Return camera worker status from the face recognition service."""
    try:
        from ..services.face_recognition_service import FaceRecognitionService
        instance = FaceRecognitionService._instance
        running = FaceRecognitionService._running

        if instance is None:
            status = 'loading'
            details = 'Camera worker is initializing...'
        elif running:
            status = 'running'
            details = f"Active — {len(instance._engine.known_embeddings if instance._engine else [])} embeddings loaded"
        else:
            status = 'stopped'
            details = 'Camera worker is not running'

        return jsonify({'status': status, 'details': details, 'running': running})
    except Exception as e:
        return jsonify({'status': 'error', 'details': str(e), 'running': False})
