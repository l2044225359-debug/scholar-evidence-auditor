#!/usr/bin/env bash
set -euo pipefail

cd /home/lh/race/workbench/services/vibevoice

export PYTHONPATH=/home/lh/race/vibevoice
export HF_HOME=/home/lh/race/vibevoice/model_cache
export VIBEVOICE_MODEL_PATH=microsoft/VibeVoice-Realtime-0.5B
export VIBEVOICE_DEVICE=cuda
export VIBEVOICE_VOICES_DIR=/home/lh/race/vibevoice/demo/voices/streaming_model
export VIBEVOICE_OUTPUT_DIR=/home/lh/race/vibevoice/vibevoice_outputs
export VIBEVOICE_WARMUP=1

exec /home/lh/race/vibevoice/.venv/bin/python app.py \
  > /home/lh/race/vibevoice/vibevoice.log 2>&1
