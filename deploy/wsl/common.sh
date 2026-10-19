#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT=/home/lh/race/workbench
WEB_ROOT="${RUNTIME_ROOT}/apps/web"
NODE_ROOT=/home/lh/.local/node-v22.23.3-linux-x64
NODE_BIN="${NODE_ROOT}/bin/node"
NPM_CLI="${NODE_ROOT}/lib/node_modules/npm/bin/npm-cli.js"
WORK_DIR="${RUNTIME_ROOT}/work"

export PATH="${NODE_ROOT}/bin:/home/lh/.local/bin:${PATH}"

mkdir -p "${WORK_DIR}"
