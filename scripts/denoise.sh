#!/usr/bin/env bash
set -euo pipefail

RECORDER_TOOL_DIR="$HOME/dev/recorder-tool"
VENV_PYTHON="$RECORDER_TOOL_DIR/.venv/bin/python3"
SAM_SCRIPT="$RECORDER_TOOL_DIR/Scripts/sam_audio_separate.py"

if [ ! -f "$VENV_PYTHON" ]; then
  echo "Error: Python venv not found at $VENV_PYTHON" >&2
  echo "Run: cd $RECORDER_TOOL_DIR && python3 -m venv .venv && source .venv/bin/activate && pip install -e External/sam-audio" >&2
  exit 1
fi

if [ ! -f "$SAM_SCRIPT" ]; then
  echo "Error: SAM-Audio script not found at $SAM_SCRIPT" >&2
  exit 1
fi

exec "$VENV_PYTHON" "$SAM_SCRIPT" "$@"
