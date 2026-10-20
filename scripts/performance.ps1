param(
  [ValidateSet("graph", "long-pdf", "long-pdf-index", "concurrency")]
  [string]$Suite = "graph",
  [int]$Pages = 240,
  [int]$Requests = 32,
  [int]$Concurrency = 8
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

$python = $env:SCHOLAR_PYTHON
if (-not $python) {
  $candidate = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($candidate) {
    $python = $candidate.Source
  }
}
if (-not $python) {
  $candidate = Join-Path $env:USERPROFILE `
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe"
  if (Test-Path -LiteralPath $candidate) {
    $python = $candidate
  }
}
if (-not $python) {
  throw "Python was not found. Set SCHOLAR_PYTHON."
}

switch ($Suite) {
  "graph" {
    & $python (Join-Path $repoRoot "tests/performance/graphrag_benchmark.py")
  }
  "long-pdf" {
    & $python (Join-Path $repoRoot "tests/performance/long_pdf_benchmark.py") `
      --pages $Pages
  }
  "long-pdf-index" {
    & $python (Join-Path $repoRoot "tests/performance/long_pdf_benchmark.py") `
      --pages $Pages --upload
  }
  "concurrency" {
    & $python (Join-Path $repoRoot "tests/performance/graphrag_http_benchmark.py") `
      --requests $Requests --concurrency $Concurrency
  }
}

exit $LASTEXITCODE
