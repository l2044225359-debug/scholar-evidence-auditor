$ErrorActionPreference = "Stop"

$checks = @(
  @{ Name = "Next.js"; Url = "http://127.0.0.1:3000/login" },
  @{ Name = "Kotaemon BFF"; Url = "http://127.0.0.1:7860/api/bff/health" },
  @{ Name = "Citation Graph"; Url = "http://127.0.0.1:8001/api/health" },
  @{ Name = "VibeVoice TTS"; Url = "http://127.0.0.1:8002/health" }
)

$failed = $false
foreach ($check in $checks) {
  try {
    $response = Invoke-WebRequest -Uri $check.Url -UseBasicParsing -TimeoutSec 10
    Write-Host ("{0,-18} HTTP {1}" -f $check.Name, $response.StatusCode) -ForegroundColor Green
  } catch {
    Write-Host ("{0,-18} FAILED: {1}" -f $check.Name, $_.Exception.Message) -ForegroundColor Red
    $failed = $true
  }
}

if ($failed) { exit 1 }
