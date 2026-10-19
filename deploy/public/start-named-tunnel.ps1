param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot "cloudflared-config.yml"),
  [string]$Cloudflared = "cloudflared.exe"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDir = Join-Path $repoRoot "outputs/public"
$logFile = Join-Path $logDir "cloudflared-named.log"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (-not (Get-Command $Cloudflared -ErrorAction SilentlyContinue)) {
  throw "cloudflared is not installed. Install it with: winget install --id Cloudflare.cloudflared"
}
if (-not (Test-Path $ConfigPath)) {
  throw "Missing Cloudflare Tunnel config: $ConfigPath"
}

try {
  $response = Invoke-WebRequest -UseBasicParsing `
    -Uri "http://localhost:3000/login" -TimeoutSec 8
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
    throw "Unexpected HTTP status $($response.StatusCode)."
  }
} catch {
  throw "Next.js is not ready at http://localhost:3000. Run npm run demo:start first. $($_.Exception.Message)"
}

Write-Host "Starting the named Cloudflare Tunnel from $ConfigPath" `
  -ForegroundColor Cyan
Write-Host "Log: $logFile"

& $Cloudflared tunnel --config $ConfigPath --no-autoupdate run 2>&1 |
  Tee-Object -FilePath $logFile
