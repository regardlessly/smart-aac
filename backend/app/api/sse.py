import json
import time
import threading
from flask import Blueprint, Response, request, jsonify

from .auth import _decode_token
from ..models.user import User

bp = Blueprint('sse', __name__)

# Shared event list for SSE
_events_lock = threading.Lock()
_event_list = []


def push_event(event_data):
    """Push an event to the SSE stream (called by services)."""
    with _events_lock:
        _event_list.append(event_data)


@bp.route('/api/events')
def events():
    """Server-Sent Events stream for real-time updates.

    SSE (EventSource) doesn't support custom headers, so we accept
    the token as a query parameter: /api/events?token=<jwt>
    """
    token = request.args.get('token', '')
    if not token:
        # Also check Authorization header (for non-EventSource clients)
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header.split(' ', 1)[1]

    if not token:
        return jsonify({'error': 'Missing token'}), 401

    payload = _decode_token(token)
    if payload is None:
        return jsonify({'error': 'Token expired or invalid'}), 401

    user = User.query.get(payload.get('user_id'))
    if user is None:
        return jsonify({'error': 'User not found'}), 401

    def generate():
        idx = 0
        keepalive_counter = 0

        while True:
            with _events_lock:
                current_len = len(_event_list)
                if idx < current_len:
                    new_events = _event_list[idx:current_len]
                    idx = current_len
                else:
                    new_events = []

            for event in new_events:
                yield f"data: {json.dumps(event)}\n\n"
                keepalive_counter = 0

            if not new_events:
                keepalive_counter += 1
                if keepalive_counter >= 30:
                    yield ": heartbeat\n\n"
                    keepalive_counter = 0

            time.sleep(1)

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )
