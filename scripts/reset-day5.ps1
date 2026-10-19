$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
  powershell -ExecutionPolicy Bypass -File scripts/wsl/sync.ps1
  if ($LASTEXITCODE -ne 0) { throw "Source sync failed" }

  powershell -ExecutionPolicy Bypass -File scripts/wsl/stop.ps1
  if ($LASTEXITCODE -ne 0) { throw "Service stop failed" }

  & wsl.exe -d Ubuntu-24.04 -u lh -- `
    /home/lh/.local/node-v22.23.3-linux-x64/bin/node `
    /home/lh/race/workbench/apps/web/scripts/reset-demo.mjs
  if ($LASTEXITCODE -ne 0) { throw "Demo database reset failed" }

  node tests/reset-bff-demo.mjs
  if ($LASTEXITCODE -ne 0) { throw "Kotaemon demo index reset failed" }

  powershell -ExecutionPolicy Bypass -File scripts/wsl/start.ps1
  if ($LASTEXITCODE -ne 0) { throw "Service restart failed" }

  powershell -ExecutionPolicy Bypass -File scripts/wsl/status.ps1
  if ($LASTEXITCODE -ne 0) { throw "Final health check failed" }
} finally {
  Pop-Location
}

Write-Host "Day 5 demo reset completed." -ForegroundColor Green
