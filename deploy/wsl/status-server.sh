#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

status=0
check_url() {
  local name="$1"
  local url="$2"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "${url}" || true)"
  printf "%-18s HTTP %s\n" "${name}" "${code}"
  if [[ "${code}" != "200" ]]; then
    status=1
  fi
}

check_ready() {
  local name="$1"
  local url="$2"
  local body
  body="$(curl -fsS --max-time 5 "${url}" 2>/dev/null || true)"
  if [[ "${body}" == *'"ready":true'* ]]; then
    printf "%-18s HTTP 200 (ready)\n" "${name}"
    return
  fi
  printf "%-18s NOT READY\n" "${name}"
  status=1
}

check_url "Next.js" "http://127.0.0.1:${PORT:-3000}/login"
check_url "Kotaemon BFF" "http://127.0.0.1:7860/api/bff/health"
check_url "Citation Graph" "http://127.0.0.1:8001/api/health"
check_ready "VibeVoice TTS" "http://127.0.0.1:8002/health"

if [[ -f "${WORK_DIR}/index-worker.lock" ]]; then
  worker_pid="$(tr -d '[:space:]' <"${WORK_DIR}/index-worker.lock")"
  if kill -0 "${worker_pid}" 2>/dev/null; then
    echo "Index worker       RUNNING (PID ${worker_pid})"
  else
    echo "Index worker       NOT RUNNING"
    status=1
  fi
else
  echo "Index worker       NOT RUNNING"
  status=1
fi

exit "${status}"
