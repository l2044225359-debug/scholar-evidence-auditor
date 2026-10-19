$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$submissionRoot = Join-Path $repoRoot "outputs/submission"
$stageName = "scholar-final-submission-$timestamp"
$stage = Join-Path $submissionRoot $stageName
$archive = Join-Path $submissionRoot "$stageName.zip"
$hashFile = Join-Path $submissionRoot "$stageName.sha256"

$excludeDirs = @(
  ".git",
  "node_modules",
  ".next",
  ".venv",
  "__pycache__",
  "ktem_app_data",
  "work",
  "outputs",
  ".theflow",
  "huggingface",
  "cache",
  "exports",
  "data",
  ".pytest_cache",
  "coverage"
)
$excludeFiles = @(
  ".env",
  ".env.local",
  "*.env",
  "cloudflared-config.yml",
  "*credentials*.json",
  "*.log",
  "*.pid",
  "*.sqlite",
  "*.sqlite-wal",
  "*.sqlite-shm",
  "*.pyc",
  "*.tsbuildinfo",
  "Thumbs.db",
  ".DS_Store"
)

New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "README.md") -Destination $stage
Copy-Item -LiteralPath (Join-Path $repoRoot "TEAM.md") -Destination $stage
Copy-Item -LiteralPath (Join-Path $repoRoot "package.json") -Destination $stage
Copy-Item -LiteralPath (Join-Path $repoRoot ".gitignore") -Destination $stage
foreach ($document in @("PRODUCT.md", "DESIGN.md")) {
  $path = Join-Path $repoRoot $document
  if (Test-Path $path) {
    Copy-Item -LiteralPath $path -Destination $stage
  }
}

foreach ($name in @(
  ".github",
  "apps",
  "deploy",
  "docs",
  "scripts",
  "services",
  "tests"
)) {
  $source = Join-Path $repoRoot $name
  $target = Join-Path $stage $name
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  & robocopy.exe $source $target /E /XJ /R:1 /W:1 /NFL /NDL /NP `
    /XD $excludeDirs /XF $excludeFiles | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "Failed to stage $name"
  }
}

$deliverables = Join-Path $stage "deliverables"
New-Item -ItemType Directory -Path $deliverables -Force | Out-Null
foreach ($name in @(
  "Scholar-demo.mp4",
  "Scholar-technical-document.pdf"
)) {
  $path = Join-Path $repoRoot "outputs/$name"
  if (-not (Test-Path $path)) {
    throw "Missing required submission deliverable: outputs/$name"
  }
  Copy-Item -LiteralPath $path -Destination (Join-Path $deliverables $name)
}

$samples = Join-Path $stage "samples"
New-Item -ItemType Directory -Path $samples -Force | Out-Null
foreach ($name in @(
  "attention.pdf",
  "attention_scan_batch20.pdf",
  "rag_2005.11401.pdf",
  "dpr_2004.04906.pdf",
  "react_2210.03629.pdf",
  "self_rag_2310.11511.pdf",
  "lost_in_middle_2307.03172.pdf"
)) {
  Copy-Item -LiteralPath (Join-Path $repoRoot "work/$name") `
    -Destination (Join-Path $samples $name)
}

$evidence = Join-Path $stage "evidence"
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "tests/evaluation/results.json") `
  -Destination (Join-Path $evidence "evaluation-results.json")
Copy-Item -LiteralPath (Join-Path $repoRoot ".impeccable/design.json") `
  -Destination (Join-Path $evidence "design.json")
foreach ($name in @(
  "day5_workspace.png",
  "day5_chat_zh.png",
  "design_workspace_final2.png",
  "design_mobile_final3.png",
  "design_login.png",
  "design_documents_final.png",
  "design_citations_final.png",
  "design_audit_final.png",
  "design_admin_final.png",
  "design_system_final2.png",
  "design_workspace_en.png",
  "day5_voice_en.png",
  "day6_dedupe_v1_v7.png",
  "day6_pdf_reader.png",
  "day6_agent_trace.png",
  "day6_agent_csv.png",
  "day6_agent_scripts.png",
  "day6_writing_framework.png",
  "day6_local_citation_graph.png",
  "knowledge-overview-desktop.png"
)) {
  $path = Join-Path $repoRoot "outputs/$name"
  if (Test-Path $path) {
    Copy-Item -LiteralPath $path -Destination (Join-Path $evidence $name)
  }
}

$textExtensions = @(
  ".md",
  ".txt",
  ".json",
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".py",
  ".sh",
  ".ps1",
  ".yaml",
  ".yml",
  ".toml",
  ".example"
)
$keyPattern = "sk-ws-[A-Za-z0-9._-]{20,}"
$leak = Get-ChildItem $stage -Recurse -File |
  Where-Object { $textExtensions -contains $_.Extension.ToLowerInvariant() } |
  Select-String -Pattern $keyPattern -List
if ($leak) {
  throw "Submission package contains an API key pattern. Packaging aborted."
}

$unexpectedSecrets = Get-ChildItem $stage -Recurse -File |
  Where-Object {
    $_.Name -eq ".env" -or
    $_.Name -eq ".env.local" -or
    $_.Name -eq "cloudflared-config.yml" -or
    $_.Name -match "credentials.*\.json$"
  }
if ($unexpectedSecrets) {
  throw "Submission package contains runtime secret files. Packaging aborted."
}

Compress-Archive -LiteralPath $stage -DestinationPath $archive -CompressionLevel Optimal
$stream = [IO.File]::OpenRead($archive)
try {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = [BitConverter]::ToString(
      $sha256.ComputeHash($stream)
    ).Replace("-", "")
  } finally {
    $sha256.Dispose()
  }
} finally {
  $stream.Dispose()
}
[IO.File]::WriteAllText(
  $hashFile,
  "$hash  $([IO.Path]::GetFileName($archive))`r`n",
  [Text.Encoding]::ASCII
)

$sizeMb = [Math]::Round((Get-Item $archive).Length / 1MB, 2)
Write-Host "Submission archive: $archive" -ForegroundColor Green
Write-Host "Size: $sizeMb MB"
Write-Host "SHA256: $hashFile"
Remove-Item -LiteralPath $stage -Recurse -Force
