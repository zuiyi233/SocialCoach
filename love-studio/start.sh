#!/usr/bin/env bash
# ============================================================================
#  SocialCoach . Love Studio - one-command local start (macOS / Linux)
#
#    Backend  -> http://127.0.0.1:8000   (FastAPI + SQLite)
#    Frontend -> http://127.0.0.1:5180   (Vite dev server; proxies /api to :8000)
#    Health   -> http://127.0.0.1:5180/api/health  (through the frontend proxy)
#
#  Installs into repo-local folders only:
#    python venv : .venv/            (never a global or $HOME install)
#    node modules: frontend/node_modules/
#
#  Only one of the dev server / preview server can hold :5180 at a time.
#  Use play.sh for the built (preview) version; do not run both at once.
#  Override the port with STUDIO_PORT (frontend) / BACKEND_PORT (backend).
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")"

STUDIO_PORT="${STUDIO_PORT:-5180}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
export STUDIO_PORT

PY=".venv/bin/python"
ROOT="$(pwd)"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[studio] ERROR: python3 not found on PATH. Install Python 3.11+ first." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[studio] ERROR: npm not found on PATH. Install Node.js first." >&2
  exit 1
fi

# --- backend venv + deps ---
if [ ! -x "$PY" ]; then
  echo "[studio] creating python venv at .venv ..."
  python3 -m venv .venv
fi
echo "[studio] installing backend dependencies (pip) ..."
"$PY" -m pip install --upgrade pip >/dev/null
"$PY" -m pip install -e AnimaBackend

# --- frontend deps ---
if [ ! -d frontend/node_modules ]; then
  echo "[studio] installing frontend dependencies (npm) ..."
  ( cd frontend && npm install )
fi

cleanup() {
  [ -n "${BACK_PID:-}" ] && kill "$BACK_PID" 2>/dev/null || true
  [ -n "${FRONT_PID:-}" ] && kill "$FRONT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- start backend (:8000) ---
echo "[studio] starting backend on :$BACKEND_PORT ..."
( cd AnimaBackend && exec "$ROOT/$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" ) &
BACK_PID=$!

# --- start frontend (:5180) ---
echo "[studio] starting frontend on :$STUDIO_PORT ..."
( cd frontend && exec npm run dev ) &
FRONT_PID=$!

# --- wait for the health endpoint through the frontend proxy ---
echo "[studio] waiting for http://127.0.0.1:$STUDIO_PORT/api/health ..."
if ! "$PY" - "$STUDIO_PORT" <<'PY'
import sys, time, urllib.request
port = sys.argv[1]
url = f"http://127.0.0.1:{port}/api/health"
deadline = time.time() + 120
while time.time() < deadline:
    try:
        urllib.request.urlopen(url, timeout=2)
        sys.exit(0)
    except Exception:
        time.sleep(1)
sys.exit(1)
PY
then
  echo "[studio] ERROR: health did not answer in time. Check the log lines above." >&2
  exit 1
fi

URL="http://127.0.0.1:$STUDIO_PORT/"
echo
echo "[studio] Love Studio is up: $URL"
echo "[studio] (health: ${URL}api/health)"
# open the browser if the platform has a helper
if command -v open >/dev/null 2>&1; then open "$URL" || true
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" || true
fi

echo "[studio] Press Ctrl+C to stop both servers."
wait