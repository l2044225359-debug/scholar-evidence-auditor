$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$kotaemonSource = "/mnt/c/Users/lenovo/Documents/Codex/2026-10-17/https-www-boxuegu-com-matchtrack-detail/services/kotaemon/"
$citationSource = "/mnt/c/Users/lenovo/Documents/Codex/2026-10-17/https-www-boxuegu-com-matchtrack-detail/services/citation-graph/"

if (-not (Test-Path (Join-Path $repoRoot "services/kotaemon/app.py"))) {
  throw "Kotaemon source directory is missing."
}

wsl -d Ubuntu-24.04 -u lh -e bash -lc @"
rsync -a \
  --exclude '.env' \
  --exclude '.venv' \
  --exclude 'ktem_app_data' \
  --exclude '__pycache__' \
  --exclude '*.log' \
  --exclude '*.pid' \
  '$kotaemonSource' /home/lh/race/kotaemon/ && \
rsync -a \
  --exclude '.env' \
  --exclude 'cache' \
  --exclude 'exports' \
  --exclude '__pycache__' \
  --exclude '*.log' \
  --exclude '*.pid' \
  '$citationSource' /home/lh/race/citation_graph/
"@

if ($LASTEXITCODE -ne 0) {
  throw "WSL service synchronization failed."
}

Write-Host "WSL service sources synchronized." -ForegroundColor Green
