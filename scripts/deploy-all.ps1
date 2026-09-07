param(
  [ValidatePattern('^[a-z0-9][a-z0-9_-]+$')][string]$Username = 'inftverezovsky',
  [ValidatePattern('^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$')][string]$Tag = 'latest',
  [string]$SshKeyPath = "$env:USERPROFILE\.ssh\codex_deploy_ed25519",
  [switch]$Prune,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
if ($Prune) { throw '-Prune has been removed: deployment must not delete unrelated Docker resources.' }
if (-not $Apply) {
  Write-Host "Dry run: validate -> build -> publish $Username/tdata-web`:$Tag -> deploy its digest to canonical TData."
  Write-Host 'No Docker or SSH commands run. Pass -Apply to execute.'
  return
}
Push-Location (Join-Path $PSScriptRoot '..')
try {
  & npm run check | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Local quality checks failed; publication cancelled.' }
  $image = & "$PSScriptRoot/build-and-push.ps1" -Username $Username -Tag $Tag -Apply
  if (-not $image) { throw 'Image publication did not return a digest.' }
  & "$PSScriptRoot/ssh-redeploy.ps1" -KeyPath $SshKeyPath -Image $image -Apply
} finally { Pop-Location }
