param(
  [switch]$FullEvaluation
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
  & powershell -ExecutionPolicy Bypass -File scripts/wsl/sync.ps1
  if ($LASTEXITCODE -ne 0) { throw "WSL source sync failed" }

  & wsl.exe -d Ubuntu-24.04 -u lh -- `
    /home/lh/race/workbench/deploy/wsl/bootstrap.sh --build
  if ($LASTEXITCODE -ne 0) { throw "WSL Next.js build failed" }

  & wsl.exe -d Ubuntu-24.04 -u lh -- bash -lc `
    "cd /home/lh/race/kotaemon && PYTHONPATH=/home/lh/race/workbench/services/kotaemon/libs/ktem:/home/lh/race/workbench/services/kotaemon/libs/kotaemon:/home/lh/race/kotaemon /home/lh/race/kotaemon/.venv/bin/python /home/lh/race/workbench/tests/test_dedupe.py"
  if ($LASTEXITCODE -ne 0) { throw "PDF dedupe tests failed" }

  powershell -ExecutionPolicy Bypass -File tests/smoke.ps1
  if ($LASTEXITCODE -ne 0) { throw "Smoke tests failed" }

  if ($FullEvaluation) {
    node tests/evaluate.mjs
    if ($LASTEXITCODE -ne 0) { throw "Evaluation thresholds failed" }
  }
} finally {
  Pop-Location
}

Write-Host "Verification passed." -ForegroundColor Green
