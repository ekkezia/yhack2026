#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Error: $PYTHON_BIN not found" >&2
  exit 1
fi

if [ ! -d "$VENV_DIR" ]; then
  echo "[cv] Creating virtual environment at $VENV_DIR"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

VENV_PY="$VENV_DIR/bin/python"

"$VENV_PY" -m pip install --upgrade pip "setuptools<82" wheel
"$VENV_PY" -m pip install -r "$SCRIPT_DIR/requirements.txt"

echo "[cv] Virtual environment is ready."
