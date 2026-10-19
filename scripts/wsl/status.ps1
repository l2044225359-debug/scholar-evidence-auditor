$ErrorActionPreference = "Stop"

& wsl.exe -d Ubuntu-24.04 -u lh -- /home/lh/race/workbench/deploy/wsl/status-server.sh
exit $LASTEXITCODE
