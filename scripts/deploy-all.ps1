param(
  [string]$Username = "inftverezovsky",
  [string]$Tag = "latest"
)

$ErrorActionPreference = "Stop"

# Resolve project root
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "      TCYBER FULL DEPLOYMENT & AUTO-CLEANUP PIPELINE           " -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Run local build & push to Docker Hub
Write-Host "==> Phase 1: Building and pushing Docker image to Docker Hub..." -ForegroundColor Yellow
& "$PSScriptRoot\build-and-push.ps1" -Username $Username -Tag $Tag

# 2. Run remote SSH Deploy
Write-Host ""
Write-Host "==> Phase 2: Connecting to production VPS and pulling latest image..." -ForegroundColor Yellow
node "$ProjectRoot\scratch\ssh-deploy.js"

if ($LASTEXITCODE -ne 0) {
  Write-Error "Remote SSH deployment phase failed."
}

# 3. Automatically perform deep local Docker cleanup to free up PC disk space
Write-Host ""
Write-Host "==> Phase 3: Deployment completed successfully!" -ForegroundColor Green
Write-Host "==> Automatically cleaning up local Docker cache and builder history to free space..." -ForegroundColor Yellow
Write-Host "---------------------------------------------------------------" -ForegroundColor Gray

docker system prune -a --volumes -f

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Green
Write-Host "  SUCCESS! DEPLOYED LIVE ON SERVER & LOCAL PC DISK CLEANED!" -ForegroundColor Green
Write-Host "===============================================================" -ForegroundColor Green
Write-Host ""
