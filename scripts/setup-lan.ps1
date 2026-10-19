$ErrorActionPreference = "Stop"

& powershell -ExecutionPolicy Bypass `
  -File (Join-Path $PSScriptRoot "wsl/setup-lan.ps1")
exit $LASTEXITCODE
