#!/usr/bin/env bash
set -euo pipefail

cd /home/lh/race/citation_graph
export PYTHONUNBUFFERED=1

exec /home/lh/race/kotaemon/.venv/bin/python app.py \
  > /home/lh/race/citation_graph/citation_graph.log 2>&1
