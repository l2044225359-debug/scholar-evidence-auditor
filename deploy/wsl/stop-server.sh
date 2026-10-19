#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

stop_pid_file() {
  local pid_file="$1"
  local expected_text="$2"
  if [[ ! -f "${pid_file}" ]]; then
    return
  fi
  local pid
  pid="$(tr -d '[:space:]' <"${pid_file}")"
  if [[ ! "${pid}" =~ ^[0-9]+$ ]] || ! kill -0 "${pid}" 2>/dev/null; then
    rm -f "${pid_file}"
    return
  fi
  local process_cwd
  process_cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
  if [[ "${process_cwd}" != "${expected_text}"* ]]; then
    echo "Refusing to stop PID ${pid}: unexpected process" >&2
    return
  fi
  kill -TERM "${pid}"
  for _ in {1..20}; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done
  rm -f "${pid_file}"
}

stop_port_process() {
  local port="$1"
  local expected_text="$2"
  local pid
  for pid in $(fuser -n tcp "${port}" 2>/dev/null || true); do
    local process_cwd
    process_cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
    if [[ "${process_cwd}" != "${expected_text}"* ]]; then
      echo "Refusing to stop port ${port} PID ${pid}: unexpected process" >&2
      continue
    fi
    kill -TERM "${pid}"
    for _ in {1..20}; do
      if ! kill -0 "${pid}" 2>/dev/null; then
        break
      fi
      sleep 0.25
    done
  done
}

stop_pid_file "${WORK_DIR}/next-server.pid" "${WEB_ROOT}"
stop_pid_file "${WORK_DIR}/index-worker.pid" "${WEB_ROOT}"
stop_pid_file "${WORK_DIR}/vibevoice.pid" "${RUNTIME_ROOT}/services/vibevoice"
stop_pid_file "${WORK_DIR}/kotaemon.pid" "/home/lh/race/kotaemon"
stop_port_process 3000 "${WEB_ROOT}"
stop_port_process 7860 "/home/lh/race/kotaemon"
stop_port_process 8001 "/home/lh/race/citation_graph"
stop_port_process 8002 "${RUNTIME_ROOT}/services/vibevoice"
rm -f "${WORK_DIR}/index-worker.lock"

echo "WSL workbench processes stopped"
