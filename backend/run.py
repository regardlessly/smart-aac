#!/usr/bin/env python3
"""Entry point for the Smart AAC backend."""

import os
import sys
import socket

# Force FFMPEG single-threaded H.264 decoding BEFORE any cv2 import.
# With 16 concurrent RTSP streams, the default multi-thread decoder
# hits "Assertion fctx->async_lock failed" which abort()s the process.
# Using slice-based threading with a single thread avoids the race.
os.environ.setdefault(
    'OPENCV_FFMPEG_CAPTURE_OPTIONS',
    'rtsp_transport;tcp|threads;1|thread_type;slice'
)

# Ensure the backend directory is on the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from app import create_app

app = create_app()

if __name__ == '__main__':
    local_ip = socket.gethostbyname(socket.gethostname())
    print('=' * 60)
    print('Smart AAC Backend')
    print('=' * 60)
    print(f'Local:   http://127.0.0.1:5001')
    print(f'Network: http://{local_ip}:5001')
    print('=' * 60)
    # Allow overriding port via PORT env var (fallback 5001)
    port = int(os.environ.get('PORT', '5001'))
    app.run(host='0.0.0.0', port=port, threaded=True,
            debug=False)
