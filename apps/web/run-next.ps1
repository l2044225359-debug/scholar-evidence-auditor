$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path "node_modules")) {
  npm install
}

if (-not (Test-Path ".next")) {
  npm run build
}

npm run start
