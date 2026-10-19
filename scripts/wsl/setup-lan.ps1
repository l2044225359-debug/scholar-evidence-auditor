$ErrorActionPreference = "Stop"
$ruleName = "Scholar Workspace LAN"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)) {
  throw "LAN setup requires an Administrator PowerShell."
}

$wslReady = $false
for ($attempt = 1; $attempt -le 30; $attempt += 1) {
  & wsl.exe -d Ubuntu-24.04 -u lh -- curl -fsS --max-time 3 `
    http://127.0.0.1:3000/login 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $wslReady = $true
    break
  }
  Start-Sleep -Seconds 1
}
if (-not $wslReady) {
  throw "WSL Next.js is not ready on port 3000. Run npm run demo:start first."
}

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existing) {
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 3000 `
    -Profile Private | Out-Null
}

$wslAddressLine = (& wsl.exe -d Ubuntu-24.04 -- hostname -I | Out-String).Trim()
$wslIp = ($wslAddressLine -split "\s+")[0]
if (-not $wslIp) {
  throw "Could not determine the WSL IPv4 address."
}

& netsh.exe interface portproxy delete v4tov4 `
  listenaddress=0.0.0.0 listenport=3000 2>$null | Out-Null
& netsh.exe interface portproxy add v4tov4 `
  listenaddress=0.0.0.0 listenport=3000 `
  connectaddress=$wslIp connectport=3000 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create the Windows-to-WSL port proxy."
}

$localReady = $false
for ($attempt = 1; $attempt -le 15; $attempt += 1) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:3000/login" `
      -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
      $localReady = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $localReady) {
  throw "The port proxy was configured, but localhost:3000 is still unavailable."
}

$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
  Where-Object {
    $_.IPAddress -ne "127.0.0.1" -and
    $_.InterfaceAlias -notmatch "Loopback|WSL" -and
    -not $_.IPAddress.StartsWith("198.18.") -and
    -not $_.IPAddress.StartsWith("172.29.") -and
    $_.PrefixOrigin -ne "WellKnown"
  } |
  Select-Object -First 1 -ExpandProperty IPAddress

Write-Host "WSL target: $wslIp" -ForegroundColor DarkGray
Write-Host "LAN URL:    http://${lanIp}:3000" -ForegroundColor Green
Write-Host "Local URL:  http://localhost:3000" -ForegroundColor Green
