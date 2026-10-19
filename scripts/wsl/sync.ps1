$ErrorActionPreference = "Stop"

& powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File (Join-Path $PSScriptRoot "../sync-services.ps1")
if ($LASTEXITCODE -ne 0) {
  throw "WSL service source sync failed"
}

& wsl.exe -d Ubuntu-24.04 -u lh -- /home/lh/race/workbench/deploy/wsl/sync-from-windows.sh
if ($LASTEXITCODE -ne 0) {
  throw "WSL source sync failed"
}
