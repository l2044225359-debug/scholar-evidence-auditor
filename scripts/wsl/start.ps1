$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$workDir = Join-Path $repoRoot "work"
$launcherPidPath = Join-Path $workDir "wsl-server.pid"
$stdoutLog = Join-Path $workDir "wsl-server.out.log"
$stderrLog = Join-Path $workDir "wsl-server.err.log"

& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "sync.ps1")
if ($LASTEXITCODE -ne 0) {
  throw "WSL source sync failed"
}

New-Item -ItemType Directory -Path $workDir -Force | Out-Null
$launcher = Start-Process `
  -FilePath "wsl.exe" `
  -ArgumentList @(
    "-d", "Ubuntu-24.04",
    "-u", "lh",
    "--",
    "/home/lh/race/workbench/deploy/wsl/run-server.sh"
  ) `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru
$launcher.Id | Set-Content $launcherPidPath

$deadline = (Get-Date).AddSeconds(240)
$ready = $false
while ((Get-Date) -lt $deadline) {
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  & wsl.exe -d Ubuntu-24.04 -u lh -- `
    /home/lh/race/workbench/deploy/wsl/status-server.sh *> $null
  $statusExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($statusExitCode -eq 0) {
    $ready = $true
    break
  }
  Start-Sleep -Seconds 3
}

if (-not $ready) {
  & wsl.exe -d Ubuntu-24.04 -u lh -- `
    /home/lh/race/workbench/deploy/wsl/status-server.sh
  throw "WSL services did not become ready. See $stderrLog"
}

& wsl.exe -d Ubuntu-24.04 -u lh -- /home/lh/race/workbench/deploy/wsl/status-server.sh
if ($LASTEXITCODE -ne 0) {
  throw "WSL server health check failed"
}

Write-Host "Windows client: http://localhost:3000" -ForegroundColor Green
