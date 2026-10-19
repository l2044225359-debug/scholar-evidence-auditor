$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdmin = $principal.IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "`"$PSCommandPath`""
  )
  Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments
  exit
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  Write-Host "Starting Scholar in WSL..." -ForegroundColor Cyan
  $started = $false
  for ($attempt = 1; $attempt -le 2; $attempt += 1) {
    if ($attempt -gt 1) {
      Write-Host "Retrying WSL startup..." -ForegroundColor Yellow
      Start-Sleep -Seconds 3
    }
    & npm.cmd run demo:start
    if ($LASTEXITCODE -eq 0) {
      $started = $true
      break
    }
  }
  if (-not $started) {
    throw "Scholar failed to start. Review work\wsl-server.err.log."
  }

  Write-Host "Refreshing the Windows-to-WSL port proxy..." -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass `
    -File (Join-Path $PSScriptRoot "setup-lan.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "The service started, but localhost forwarding failed."
  }

  Start-Process "http://localhost:3000"
  Write-Host "Scholar is ready at http://localhost:3000" -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "Startup log: $repoRoot\work\wsl-server.err.log"
} finally {
  Pop-Location
  Write-Host ""
  Read-Host "Press Enter to close"
}
