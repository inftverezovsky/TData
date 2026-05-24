param(
  [string]$HostName = "82.147.67.231",
  [string]$User = "root",
  [string]$KeyPath = "$env:USERPROFILE\.ssh\tcyber_vps_82_147_67_231",
  [string]$RemoteDir = "/root/tcyber",
  [string]$Service = "web",
  [string]$HealthUrl = "http://82.147.67.231:3010/api/health"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  Write-Error "OpenSSH client is not available in PATH."
}

if (-not (Test-Path -LiteralPath $KeyPath)) {
  Write-Error "SSH key not found at $KeyPath. Create the key or pass -KeyPath."
}

$sshTarget = "${User}@${HostName}"
$sshOptions = @(
  "-i", $KeyPath,
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=accept-new"
)

$remoteScript = @"
set -eu
cd "$RemoteDir"
echo "=== REMOTE DISK SPACE ==="
df -h /
echo "=== PULLING IMAGE ==="
docker compose pull "$Service"
echo "=== RECREATING SERVICE ==="
docker compose up -d --no-deps --force-recreate "$Service"
echo "=== SERVICE STATUS ==="
docker compose ps "$Service"
echo "=== SERVICE IMAGE ==="
cid=`$(docker compose ps -q "$Service")
docker inspect --format='{{.Image}}' "`$cid"
"@

Write-Host "==> Connecting to $sshTarget with key auth..." -ForegroundColor Yellow
$remoteScript | ssh @sshOptions $sshTarget "bash -s"

if ($LASTEXITCODE -ne 0) {
  Write-Error "Remote SSH deployment failed."
}

Write-Host ""
Write-Host "==> Verifying production health: $HealthUrl" -ForegroundColor Yellow
$health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 30
$healthJson = $health | ConvertTo-Json -Depth 10
Write-Host $healthJson

if ($health.ok -ne $true) {
  Write-Host ""
  Write-Host "==> Health check failed. Fetching recent remote logs..." -ForegroundColor Yellow
  $logCommand = "cd ""$RemoteDir"" && docker compose logs --tail=120 ""$Service"""
  ssh @sshOptions $sshTarget $logCommand
  Write-Error "Production health check did not return ok=true."
}

Write-Host ""
Write-Host "==> Production health is ok." -ForegroundColor Green
