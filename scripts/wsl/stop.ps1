$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$launcherPidPath = Join-Path $repoRoot "work/wsl-server.pid"

& wsl.exe -d Ubuntu-24.04 -u lh -- /home/lh/race/workbench/deploy/wsl/stop-server.sh
$wslExitCode = $LASTEXITCODE

if (Test-Path $launcherPidPath) {
  $launcherPid = [int](Get-Content $launcherPidPath)
  $launcher = Get-Process -Id $launcherPid -ErrorAction SilentlyContinue
  if ($launcher) {
    Stop-Process -Id $launcherPid -Force
  }
  Remove-Item -LiteralPath $launcherPidPath -Force
}

if ($wslExitCode -ne 0) {
  throw "WSL workbench shutdown failed"
}
