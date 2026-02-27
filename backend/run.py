#!/usr/bin/env python3
"""Entry point for the Smart AAC backend."""

import os
import sys
import socket

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
    app.run(host='0.0.0.0', port=5001, threaded=True,
            debug=True, use_reloader=False)
