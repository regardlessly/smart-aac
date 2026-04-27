"""Serves the standalone web-based enrollment SPA at GET /enroll."""

import os

from flask import Blueprint, send_from_directory

bp = Blueprint('enroll_ui', __name__)

_STATIC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'static', 'enroll',
)


@bp.route('/enroll')
@bp.route('/enroll/')
def enroll_ui():
    return send_from_directory(_STATIC, 'index.html')
