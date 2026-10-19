$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Assert-Http {
  param([string]$Name, [string]$Url)
  $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 15
  if ($response.StatusCode -ne 200) {
    throw "$Name returned HTTP $($response.StatusCode)"
  }
  Write-Host "PASS $Name" -ForegroundColor Green
}

Assert-Http "Next login" "http://127.0.0.1:3000/login"
Assert-Http "Kotaemon BFF" "http://127.0.0.1:7860/api/bff/health"
Assert-Http "Citation Graph" "http://127.0.0.1:8001/api/health"
Assert-Http "VibeVoice TTS" "http://127.0.0.1:8002/health"

try {
  Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/files" `
    -UseBasicParsing -TimeoutSec 10 | Out-Null
  throw "Unauthenticated file API unexpectedly succeeded"
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 401) {
    throw
  }
}
Write-Host "PASS unauthenticated API rejection" -ForegroundColor Green

$workerLock = & wsl.exe -d Ubuntu-24.04 -u lh -- `
  cat /home/lh/race/workbench/work/index-worker.lock 2>$null
if ($LASTEXITCODE -ne 0 -or -not $workerLock) {
  throw "WSL index worker lock is missing"
}
$workerPid = [int]($workerLock | Select-Object -First 1)
& wsl.exe -d Ubuntu-24.04 -u lh -- kill -0 $workerPid 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "Index worker is not running"
}
Write-Host "PASS single index worker" -ForegroundColor Green

node (Join-Path $PSScriptRoot "test-sse.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "SSE smoke test failed"
}
Write-Host "PASS SSE stream" -ForegroundColor Green

node (Join-Path $PSScriptRoot "test-proxies.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "Authenticated proxy smoke test failed"
}
Write-Host "PASS authenticated proxies and PDF preview" -ForegroundColor Green
