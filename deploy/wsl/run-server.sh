#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

PORT="${PORT:-3000}"
NEXT_LOG="${WORK_DIR}/next-server.log"
WORKER_LOG="${WORK_DIR}/index-worker.log"
KOTAEMON_LOG="${WORK_DIR}/kotaemon-launch.log"
VIBEVOICE_LOG="${WORK_DIR}/vibevoice-launch.log"
WORKER_LOCK="${WORK_DIR}/index-worker.lock"

http_ok() {
  curl -fsS --max-time 3 "$1" >/dev/null 2>&1
}

health_ready() {
  curl -fsS --max-time 3 "$1" 2>/dev/null | grep -q '"ready":true'
}

wait_for_http() {
  local url="$1"
  local attempts="${2:-60}"
  local index
  for ((index = 1; index <= attempts; index++)); do
    if http_ok "${url}"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_health() {
  local url="$1"
  local attempts="${2:-180}"
  local index
  for ((index = 1; index <= attempts; index++)); do
    if health_ready "${url}"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

"${SCRIPT_DIR}/bootstrap.sh" --build

if ! http_ok "http://127.0.0.1:7860/api/bff/health"; then
  nohup /home/lh/race/kotaemon/run_kotaemon.sh \
    >"${KOTAEMON_LOG}" 2>&1 </dev/null &
  echo "$!" >"${WORK_DIR}/kotaemon.pid"
fi

if ! wait_for_http "http://127.0.0.1:7860/api/bff/health" 120; then
  echo "Kotaemon failed to start; see ${KOTAEMON_LOG}" >&2
  exit 1
fi

if ! http_ok "http://127.0.0.1:8001/api/health"; then
  echo "Citation Graph is not available on port 8001" >&2
  exit 1
fi

if ! http_ok "http://127.0.0.1:8002/health"; then
  if [[ -x /home/lh/race/vibevoice/.venv/bin/python ]]; then
    nohup /home/lh/race/workbench/services/vibevoice/run_vibevoice.sh \
      >"${VIBEVOICE_LOG}" 2>&1 </dev/null &
    echo "$!" >"${WORK_DIR}/vibevoice.pid"
  fi
fi

if ! wait_for_health "http://127.0.0.1:8002/health" 180; then
  echo "VibeVoice failed to become ready; see ${VIBEVOICE_LOG}" >&2
  exit 1
fi

worker_alive=false
if [[ -f "${WORKER_LOCK}" ]]; then
  worker_pid="$(tr -d '[:space:]' <"${WORKER_LOCK}")"
  if [[ "${worker_pid}" =~ ^[0-9]+$ ]] && kill -0 "${worker_pid}" 2>/dev/null; then
    worker_alive=true
  fi
fi

if [[ "${worker_alive}" != true ]]; then
  cd "${WEB_ROOT}"
  nohup "${NODE_BIN}" scripts/index-worker.mjs \
    >"${WORKER_LOG}" 2>&1 </dev/null &
  echo "$!" >"${WORK_DIR}/index-worker.pid"
fi

if http_ok "http://127.0.0.1:${PORT}/login"; then
  echo "Next.js is already running on port ${PORT}"
  exit 0
fi

cd "${WEB_ROOT}"
"${NODE_BIN}" node_modules/next/dist/bin/next start \
  -H 0.0.0.0 -p "${PORT}" \
  >"${NEXT_LOG}" 2>&1 </dev/null &
next_pid="$!"
echo "${next_pid}" >"${WORK_DIR}/next-server.pid"

if ! wait_for_http "http://127.0.0.1:${PORT}/login" 90; then
  kill -TERM "${next_pid}" 2>/dev/null || true
  echo "Next.js failed to start; see ${NEXT_LOG}" >&2
  exit 1
fi

echo "WSL server ready on http://0.0.0.0:${PORT}"
wait "${next_pid}"
