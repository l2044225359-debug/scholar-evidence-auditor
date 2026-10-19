param(
  [int]$Port = 3000,
  [string]$Cloudflared = "cloudflared.exe"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDir = Join-Path $repoRoot "outputs/public"
$logFile = Join-Path $logDir "cloudflared-quick.log"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (-not (Get-Command $Cloudflared -ErrorAction SilentlyContinue)) {
  throw "cloudflared is not installed. Install it with: winget install --id Cloudflare.cloudflared"
}

try {
  $response = Invoke-WebRequest -UseBasicParsing `
    -Uri "http://localhost:$Port/login" -TimeoutSec 8
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
    throw "Unexpected HTTP status $($response.StatusCode)."
  }
} catch {
  throw "Next.js is not ready at http://localhost:$Port. Run npm run demo:start first. $($_.Exception.Message)"
}

Write-Host "Starting a temporary Cloudflare Quick Tunnel for http://localhost:$Port ..." `
  -ForegroundColor Cyan
Write-Host "The public URL is temporary and changes after the process stops." `
  -ForegroundColor Yellow
Write-Host "Log: $logFile"

& $Cloudflared tunnel --url "http://localhost:$Port" --no-autoupdate 2>&1 |
  Tee-Object -FilePath $logFile
