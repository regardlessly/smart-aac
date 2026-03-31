#!/bin/bash
# Smart AAC - Auto Startup Script
# Usage: ./start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_LOG="/tmp/smart-aac-backend.log"
FRONTEND_LOG="/tmp/smart-aac-frontend.log"
BACKEND_PORT=5001
FRONTEND_PORT=3100

# Node 20 via nvm (required for Next.js 15)
export PATH="/Users/joseph/.nvm/versions/node/v20.20.0/bin:$PATH"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       Smart AAC - Starting Up            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Kill existing processes ───────────────────
echo "▶ Stopping existing processes..."
pkill -9 -f "smart-aac.*run.py" 2>/dev/null || true
pkill -9 -f "next dev" 2>/dev/null || true
lsof -ti :$BACKEND_PORT | xargs kill -9 2>/dev/null || true
lsof -ti :$FRONTEND_PORT | xargs kill -9 2>/dev/null || true
sleep 1

# ── Backend ───────────────────────────────────
echo "▶ Starting backend (port $BACKEND_PORT)..."
cd "$BACKEND_DIR"
CAMERA_WORKER_ENABLED=true \
  "$BACKEND_DIR/venv/bin/python3" run.py >> "$BACKEND_LOG" 2>&1 &

# Wait for backend to be ready (up to 15s)
echo -n "  Waiting for backend"
for i in $(seq 1 15); do
  sleep 1
  if curl -s "http://localhost:$BACKEND_PORT/api/health" > /dev/null 2>&1; then
    echo " ✓"
    break
  fi
  echo -n "."
  if [ "$i" -eq 15 ]; then
    echo " ✗ (timeout — check $BACKEND_LOG)"
  fi
done

# ── Frontend ──────────────────────────────────
echo "▶ Starting frontend (port $FRONTEND_PORT)..."
cd "$FRONTEND_DIR"
PORT=$FRONTEND_PORT npm run dev >> "$FRONTEND_LOG" 2>&1 &

# Wait for frontend to be ready (up to 30s)
echo -n "  Waiting for frontend"
for i in $(seq 1 30); do
  sleep 1
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$FRONTEND_PORT/" 2>/dev/null || echo "000")
  if [ "$STATUS" = "307" ] || [ "$STATUS" = "200" ]; then
    echo " ✓"
    break
  fi
  echo -n "."
  if [ "$i" -eq 30 ]; then
    echo " ✗ (timeout — check $FRONTEND_LOG)"
  fi
done

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ✓ Smart AAC is running!                 ║"
echo "║                                          ║"
echo "║  Dashboard: http://localhost:$FRONTEND_PORT        ║"
echo "║  Backend:   http://localhost:$BACKEND_PORT         ║"
echo "║                                          ║"
echo "║  Cameras loading in background...        ║"
echo "║  Logs: /tmp/smart-aac-*.log              ║"
echo "╚══════════════════════════════════════════╝"
echo ""
