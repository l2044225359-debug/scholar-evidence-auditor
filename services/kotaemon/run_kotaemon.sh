#!/usr/bin/env bash
set -euo pipefail

cd /home/lh/race/kotaemon

set -a
# shellcheck disable=SC1091
source .env
set +a

# The Citation Graph tab depends on this local companion service.
if ! curl -fsS --max-time 2 http://127.0.0.1:8001/api/health >/dev/null 2>&1; then
  nohup /home/lh/race/citation_graph/run_citation_graph.sh \
    >/dev/null 2>&1 &
  for _ in {1..20}; do
    if curl -fsS --max-time 1 \
      http://127.0.0.1:8001/api/health >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
fi

exec .venv/bin/python app.py > /home/lh/race/kotaemon/ktem_app.log 2>&1
