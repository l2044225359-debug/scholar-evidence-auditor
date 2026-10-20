param(
  [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$workDir = Join-Path $repoRoot "work"
$envPath = Join-Path $repoRoot "apps/web/.env.local"
$bffBase = "http://127.0.0.1:7860"
$reportPath = Join-Path $workDir "structured-reindex.json"
$curl = (Get-Command curl.exe -ErrorAction Stop).Source

function Read-Token {
  if (-not (Test-Path -LiteralPath $envPath)) {
    throw "apps/web/.env.local is missing"
  }
  $line = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match "^CHAT_BFF_TOKEN=" } |
    Select-Object -First 1
  if (-not $line) {
    throw "CHAT_BFF_TOKEN is missing from apps/web/.env.local"
  }
  return ($line -split "=", 2)[1].Trim().Trim('"').Trim("'")
}

function Invoke-CurlJson {
  param([string[]]$Arguments)
  $output = & $curl @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "curl failed ($LASTEXITCODE): $($output -join ' ')"
  }
  return (($output -join "`n") | ConvertFrom-Json)
}

function Wait-ForBff {
  for ($attempt = 1; $attempt -le 120; $attempt += 1) {
    try {
      $health = Invoke-RestMethod `
        -Uri "$bffBase/api/bff/health" `
        -TimeoutSec 5
      if ($health.status -eq "ok") {
        return
      }
    } catch {
      Start-Sleep -Seconds 1
    }
    Start-Sleep -Seconds 1
  }
  throw "Kotaemon BFF did not become healthy"
}

New-Item -ItemType Directory -Path $workDir -Force | Out-Null
$token = Read-Token
$authHeader = "X-BFF-Token: $token"

if (-not $SkipRestart) {
  Write-Host "Restarting WSL services to load structured evidence parsing..." `
    -ForegroundColor Cyan
  & powershell -NoProfile -ExecutionPolicy Bypass `
    -File (Join-Path $PSScriptRoot "wsl/stop.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "WSL service shutdown failed"
  }
  & powershell -NoProfile -ExecutionPolicy Bypass `
    -File (Join-Path $PSScriptRoot "wsl/start.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "WSL service startup failed"
  }
}

Wait-ForBff
$filesPayload = Invoke-CurlJson @(
  "-fsS",
  "--max-time", "20",
  "-H", $authHeader,
  "$bffBase/api/bff/files"
)
$files = @($filesPayload.items)
if (-not $files.Count) {
  throw "No indexed documents were returned by the BFF"
}

$expectedNames = @(
  "attention.pdf",
  "attention_scan_batch20.pdf",
  "dpr_2004.04906.pdf",
  "lost_in_middle_2307.03172.pdf",
  "rag_2005.11401.pdf",
  "react_2210.03629.pdf",
  "self_rag_2310.11511.pdf"
)
$candidates = @()
$candidateNames = @{}
foreach ($file in $files) {
  $localPath = Join-Path $workDir $file.name
  if (Test-Path -LiteralPath $localPath -PathType Leaf) {
    $candidates += [pscustomobject]@{
      old_id = $file.id
      name = $file.name
      path = $localPath
      old_size = $file.size
      local_size = (Get-Item -LiteralPath $localPath).Length
    }
    $candidateNames[$file.name] = $true
  }
}
foreach ($name in $expectedNames) {
  if ($candidateNames.ContainsKey($name)) {
    continue
  }
  $localPath = Join-Path $workDir $name
  if (-not (Test-Path -LiteralPath $localPath -PathType Leaf)) {
    continue
  }
  $candidates += [pscustomobject]@{
    old_id = ""
    name = $name
    path = $localPath
    old_size = 0
    local_size = (Get-Item -LiteralPath $localPath).Length
  }
}

if (-not $candidates.Count) {
  throw "No matching PDFs were found in the work directory"
}

$mismatches = @($candidates | Where-Object {
  $_.old_id -and $_.old_size -ne $_.local_size
})
if ($mismatches.Count) {
  $names = $mismatches.name -join ", "
  throw "Local PDF size mismatch for: $names"
}

Write-Host "Reindexing $($candidates.Count) documents sequentially..." `
  -ForegroundColor Cyan
$records = @()

foreach ($item in $candidates) {
  Write-Host "Reindexing $($item.name)..."
  if ($item.old_id) {
    Invoke-CurlJson @(
      "-fsS",
      "--max-time", "60",
      "-X", "DELETE",
      "-H", $authHeader,
      "$bffBase/api/bff/files/$($item.old_id)"
    ) | Out-Null
  }

  $newId = ""
  $lastError = ""
  for ($attempt = 1; $attempt -le 2; $attempt += 1) {
    try {
      $upload = Invoke-CurlJson @(
        "-fsS",
        "--max-time", "1800",
        "-H", $authHeader,
        "-F", "file=@$($item.path);type=application/pdf",
        "$bffBase/api/bff/index"
      )
      $newId = [string]($upload.file_ids | Select-Object -First 1)
      if (-not $newId) {
        throw "BFF returned no new file id"
      }
      break
    } catch {
      $lastError = $_.Exception.Message
      if ($attempt -lt 2) {
        Start-Sleep -Seconds 3
      }
    }
  }

  if (-not $newId) {
    throw "Reindex failed for $($item.name): $lastError"
  }

  $records += [pscustomobject]@{
    name = $item.name
    old_id = $(if ($item.old_id) { $item.old_id } else { $null })
    new_id = $newId
    reindexed_at = (Get-Date).ToUniversalTime().ToString("o")
  }
  Write-Host "  $($item.old_id) -> $newId" -ForegroundColor Green
}

$overview = Invoke-CurlJson @(
  "-fsS",
  "--max-time", "180",
  "-H", $authHeader,
  "$bffBase/api/bff/knowledge-overview?refresh=1"
)
$structured = $overview.structured_evidence
if (-not $structured) {
  throw "Knowledge overview did not return structured evidence counts"
}
$structuredTotal = [int]$structured.tables +
  [int]$structured.formulas +
  [int]$structured.figures

$report = [pscustomobject]@{
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  documents = $overview.documents
  structured_evidence = $structured
  structured_total = $structuredTotal
  mappings = $records
}
$report | ConvertTo-Json -Depth 8 |
  Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host ""
Write-Host "Reindex complete:" -ForegroundColor Green
Write-Host "  documents: $($overview.documents)"
Write-Host "  tables: $($structured.tables)"
Write-Host "  formulas: $($structured.formulas)"
Write-Host "  figures: $($structured.figures)"
Write-Host "  report: $reportPath"

if ($structuredTotal -le 0) {
  throw "Reindex completed but no structured evidence was detected"
}
