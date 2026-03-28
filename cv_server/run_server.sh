#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
VENV_PY="$VENV_DIR/bin/python"

if [ ! -x "$VENV_PY" ]; then
  echo "[cv] No virtualenv detected, bootstrapping..."
  bash "$SCRIPT_DIR/setup_venv.sh"
fi

if ! "$VENV_PY" - <<'PY' >/dev/null 2>&1
import ultralytics, flask, cv2, numpy
PY
then
  echo "[cv] Missing Python dependencies in virtualenv, installing..."
  bash "$SCRIPT_DIR/setup_venv.sh"
fi

echo "[cv] Starting YOLO CV server (first run may download model weights)..."
exec env PYTHONUNBUFFERED=1 "$VENV_PY" "$SCRIPT_DIR/server.py"
