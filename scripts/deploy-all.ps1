param(
  [string]$Username = "inftverezovsky",
  [string]$Tag = "latest",
  [string]$SshKeyPath = "$env:USERPROFILE\.ssh\tcyber_vps_82_147_67_231",
  [switch]$Prune
)

$ErrorActionPreference = "Stop"

# Resolve project root
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "              TCYBER FULL DEPLOYMENT PIPELINE                  " -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Run local build & push to Docker Hub
Write-Host "==> Phase 1: Building and pushing Docker image to Docker Hub..." -ForegroundColor Yellow
& "$PSScriptRoot\build-and-push.ps1" -Username $Username -Tag $Tag

# 2. Run remote SSH Deploy
Write-Host ""
Write-Host "==> Phase 2: Connecting to production VPS and pulling latest image..." -ForegroundColor Yellow
& "$PSScriptRoot\ssh-redeploy.ps1" -KeyPath $SshKeyPath

if ($LASTEXITCODE -ne 0) {
  Write-Error "Remote SSH deployment phase failed."
}

Write-Host ""
Write-Host "==> Phase 3: Deployment completed successfully!" -ForegroundColor Green

if ($Prune) {
  Write-Host "==> Prune requested. Cleaning unused local Docker images/build cache..." -ForegroundColor Yellow
  Write-Host "---------------------------------------------------------------" -ForegroundColor Gray
  docker system prune -a -f
} else {
  Write-Host "==> Skipping Docker prune. Pass -Prune to clean unused local Docker images/build cache." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Green
Write-Host "            SUCCESS! DEPLOYED LIVE ON SERVER!" -ForegroundColor Green
Write-Host "===============================================================" -ForegroundColor Green
Write-Host ""
