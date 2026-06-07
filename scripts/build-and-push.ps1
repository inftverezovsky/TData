param(
  [string]$Username = "",
  [string]$Tag = "latest"
)

$ErrorActionPreference = "Stop"

# Resolve project root
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

# If username is empty, prompt for it
if (-not $Username) {
  Write-Host ""
  Write-Host "=============================================" -ForegroundColor Cyan
  Write-Host "    TDATA DOCKER HUB BUILD & PUSH UTILITY    " -ForegroundColor Cyan
  Write-Host "=============================================" -ForegroundColor Cyan
  $Username = Read-Host "Enter your Docker Hub Username"
  if (-not $Username) {
    Write-Error "Docker Hub Username cannot be empty."
  }
}

$ImageName = "${Username}/tdata-web:${Tag}"

Write-Host ""
Write-Host "==> Starting local Docker build..." -ForegroundColor Cyan
Write-Host "Image Name: $ImageName" -ForegroundColor Yellow
Write-Host "---------------------------------------------" -ForegroundColor Gray

# Run Docker Build
docker build -t $ImageName .

if ($LASTEXITCODE -ne 0) {
  Write-Error "Docker build failed."
}

Write-Host ""
Write-Host "==> Build successful! Pushing to private Docker Hub registry..." -ForegroundColor Cyan
Write-Host "---------------------------------------------" -ForegroundColor Gray

# Run Docker Push
docker push $ImageName

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "[WARNING] Push failed. Make sure you are logged in." -ForegroundColor Red
  Write-Host "Please run the command below, then try again:" -ForegroundColor Yellow
  Write-Host "  docker login" -ForegroundColor Green
  Write-Host ""
  exit 1
}

Write-Host ""
Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "   SUCCESS! IMAGE PUSHED TO DOCKER HUB!" -ForegroundColor Green
Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "You can now recreate the container on your server in Portainer:"
Write-Host "1. Open Portainer."
Write-Host "2. Go to 'Containers' -> click on 'tdata-web'."
Write-Host "3. Click the 'Recreate' button at the top."
Write-Host "4. Enable the 'Pull latest image' toggle."
Write-Host "5. Click 'Recreate'."
Write-Host "--------------------------------------------------------------------------" -ForegroundColor Gray
Write-Host "All done! The new version is live on your server." -ForegroundColor Green
Write-Host ""
