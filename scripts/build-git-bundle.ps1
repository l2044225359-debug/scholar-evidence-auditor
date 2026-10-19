param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputPath) {
  $OutputPath = Join-Path $repoRoot "outputs/Scholar-git-history.bundle"
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$outputDir = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

Push-Location $repoRoot
try {
  $dirty = git status --porcelain=v1
  if ($dirty) {
    throw "Cannot build a release bundle from a dirty worktree. Commit changes first."
  }
  if (Test-Path $OutputPath) {
    Remove-Item -LiteralPath $OutputPath -Force
  }
  git bundle create $OutputPath --all
  if ($LASTEXITCODE -ne 0) {
    throw "git bundle create failed."
  }
  git bundle verify $OutputPath
  if ($LASTEXITCODE -ne 0) {
    throw "git bundle verify failed."
  }
  $hash = (Get-FileHash $OutputPath -Algorithm SHA256).Hash
  $hashFile = "$OutputPath.sha256"
  [IO.File]::WriteAllText(
    $hashFile,
    "$hash  $([IO.Path]::GetFileName($OutputPath))`r`n",
    [Text.Encoding]::ASCII
  )
  Write-Host "Git bundle: $OutputPath" -ForegroundColor Green
  Write-Host "SHA256: $hash"
} finally {
  Pop-Location
}
