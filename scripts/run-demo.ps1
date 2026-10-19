$ErrorActionPreference = "Stop"

Write-Host "Starting the WSL-hosted runtime..." -ForegroundColor DarkGray
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "wsl/start.ps1")
exit $LASTEXITCODE
