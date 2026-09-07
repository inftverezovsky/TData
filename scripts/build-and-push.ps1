param(
  [ValidatePattern('^[a-z0-9][a-z0-9_-]+$')][string]$Username = 'inftverezovsky',
  [ValidatePattern('^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$')][string]$Tag = 'latest',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$imageName = "${Username}/tdata-web:${Tag}"
Write-Host "Build and publish plan: $imageName"
if (-not $Apply) { Write-Host 'Dry run. No build or registry write. Pass -Apply to execute.'; return }

Push-Location (Join-Path $PSScriptRoot '..')
try {
  & docker build -t $imageName . | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Docker build failed.' }
  & docker push $imageName | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Image publication failed. Authenticate with docker login in its secure prompt.' }
  # Получаем точный digest опубликованного образа; mutable tag не используется для выкладки.
  $digests = & docker image inspect --format '{{json .RepoDigests}}' $imageName
  if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the published image digest.' }
  $published = @($digests | ConvertFrom-Json) | Where-Object { $_ -match "^$([regex]::Escape("$Username/tdata-web"))@sha256:[a-f0-9]{64}$" } | Select-Object -First 1
  if (-not $published) { throw 'No immutable digest found for the published repository.' }
  Write-Host 'Image published. The server has not been changed by this script.'
  Write-Output $published
} finally { Pop-Location }
