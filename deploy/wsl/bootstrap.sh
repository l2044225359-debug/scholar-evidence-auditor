#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

NODE_VERSION=v22.23.3
NODE_ARCHIVE=/tmp/node-${NODE_VERSION}-linux-x64.tar.xz
NODE_SHA256=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de

if [[ ! -x "${NODE_BIN}" ]]; then
  curl -fL --max-time 180 \
    "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" \
    -o "${NODE_ARCHIVE}"
  printf "%s  %s\n" "${NODE_SHA256}" "${NODE_ARCHIVE}" | sha256sum -c -
  mkdir -p /home/lh/.local
  tar -xJf "${NODE_ARCHIVE}" -C /home/lh/.local
fi

cd "${WEB_ROOT}"
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
LOCK_MARKER="node_modules/.scholar-lock-hash"
if [[ ! -x node_modules/.bin/next || ! -f "${LOCK_MARKER}" || "$(cat "${LOCK_MARKER}")" != "${LOCK_HASH}" ]]; then
  "${NODE_BIN}" "${NPM_CLI}" ci \
    --registry=https://registry.npmmirror.com \
    --fetch-retries=5 \
    --fetch-timeout=120000 \
    --no-audit \
    --no-fund
  printf "%s\n" "${LOCK_HASH}" >"${LOCK_MARKER}"
fi

if [[ ! -f "${RUNTIME_ROOT}/data/demo.sqlite" ]]; then
  "${NODE_BIN}" "${NPM_CLI}" run demo:init
fi

if [[ "${1:-}" == "--build" || ! -f .next/BUILD_ID ]]; then
  "${NODE_BIN}" "${NPM_CLI}" run build
fi
