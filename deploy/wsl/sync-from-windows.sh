#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

WINDOWS_ROOT="/mnt/c/Users/lenovo/Documents/Codex/2026-10-17/https-www-boxuegu-com-matchtrack-detail"

mkdir -p "${RUNTIME_ROOT}"
rsync -a \
  --exclude=.git/ \
  --exclude=node_modules/ \
  --exclude=.next/ \
  --exclude=work/ \
  --exclude=outputs/ \
  --exclude=data/ \
  --exclude=.env \
  --exclude=.env.local \
  --exclude=tsconfig.tsbuildinfo \
  --exclude='*.log' \
  --exclude='*.pid' \
  "${WINDOWS_ROOT}/" "${RUNTIME_ROOT}/"

echo "Source synced to ${RUNTIME_ROOT}"
