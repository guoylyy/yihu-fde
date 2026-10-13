#!/bin/bash
# Local development: backend on :3005, frontend on :5173 (Vite proxies /api and /uploads to the backend)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$SCRIPT_DIR/backend/.env" ]; then
  echo "backend/.env not found. Copy backend/.env.example to backend/.env and set DATABASE_URL first."
  exit 1
fi

echo "Starting backend..."
cd "$SCRIPT_DIR/backend" && npm run dev &
BACKEND_PID=$!

sleep 2

echo "Starting frontend..."
cd "$SCRIPT_DIR/frontend" && npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Frontend: http://localhost:5173/admin/login"
echo "  Backend:  http://localhost:3005"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
