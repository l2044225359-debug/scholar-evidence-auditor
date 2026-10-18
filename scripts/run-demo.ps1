param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $repoRoot "apps/web"

function Test-HttpOk {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-HttpOk {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 90
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-HttpOk -Url $Url) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

Push-Location $webRoot
try {
  npm run demo:init

  if (-not $SkipBuild -and -not (Test-Path ".next")) {
    npm run build
  }
} finally {
  Pop-Location
}

if (-not (Test-HttpOk -Url "http://127.0.0.1:7860/api/bff/health")) {
  $wslProcess = Start-Process `
    -FilePath "wsl.exe" `
    -ArgumentList @(
      "-d", "Ubuntu-24.04",
      "-u", "lh",
      "-e", "/home/lh/race/kotaemon/run_kotaemon.sh"
    ) `
    -WindowStyle Hidden `
    -PassThru
  $wslProcess.Id | Set-Content (Join-Path $repoRoot "work/kotaemon_wsl.pid")
}

if (-not (Wait-HttpOk -Url "http://127.0.0.1:7860" -TimeoutSeconds 120)) {
  throw "Kotaemon failed to start on port 7860."
}

if (-not (Test-HttpOk -Url "http://127.0.0.1:8001/api/health")) {
  throw "Citation graph service failed to start on port 8001."
}

$workerLock = Join-Path $repoRoot "work/index-worker.lock"
if (-not (Test-Path $workerLock)) {
  $logDir = Join-Path $repoRoot "work"
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $nodePath = (Get-Command node).Source
  $workerProcess = Start-Process `
    -FilePath $nodePath `
    -ArgumentList @("scripts/index-worker.mjs") `
    -WorkingDirectory $webRoot `
    -WindowStyle Hidden `
    -PassThru
  $workerProcess.Id | Set-Content (Join-Path $logDir "index_worker.pid")
}

if (-not (Test-HttpOk -Url "http://127.0.0.1:3000/login")) {
  $nodePath = (Get-Command node).Source
  $nextProcess = Start-Process `
    -FilePath $nodePath `
    -ArgumentList @(
      "node_modules/next/dist/bin/next",
      "start",
      "-H", "0.0.0.0",
      "-p", "3000"
    ) `
    -WorkingDirectory $webRoot `
    -WindowStyle Hidden `
    -PassThru
  $nextProcess.Id | Set-Content (Join-Path $repoRoot "work/next_workspace.pid")
}

if (-not (Wait-HttpOk -Url "http://127.0.0.1:3000/login" -TimeoutSeconds 60)) {
  throw "Next.js failed to start on port 3000."
}

$lanIp = $null
try {
  $lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object {
      $_.IPAddress -ne "127.0.0.1" -and
      $_.InterfaceAlias -notmatch "Loopback|WSL" -and
      -not $_.IPAddress.StartsWith("198.18.") -and
      -not $_.IPAddress.StartsWith("172.29.") -and
      $_.PrefixOrigin -ne "WellKnown"
    } |
    Select-Object -First 1 -ExpandProperty IPAddress
} catch {
  $ipConfigText = ipconfig | Out-String
  $lanIp = [regex]::Matches(
    $ipConfigText,
    "IPv4[^\r\n]*?:\s*([0-9.]+)"
  ) |
    ForEach-Object { $_.Groups[1].Value } |
    Where-Object {
      $_ -ne "127.0.0.1" -and
      -not $_.StartsWith("172.29.") -and
      -not $_.StartsWith("198.18.") -and
      -not $_.StartsWith("169.254.")
    } |
    Select-Object -First 1
}

Write-Host ""
Write-Host "Demo is ready." -ForegroundColor Green
Write-Host "  Local: http://localhost:3000"
if ($lanIp) {
  Write-Host "  LAN:   http://${lanIp}:3000"
}
Write-Host "  BFF:   http://localhost:7860/api/bff/health"
Write-Host "  Graph: http://localhost:8001"
