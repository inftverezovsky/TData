param(
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9.-]*$')][string]$HostName = '82.147.67.231',
  [ValidatePattern('^[a-z_][a-z0-9_-]*$')][string]$User = 'root',
  [string]$KeyPath = "$env:USERPROFILE\.ssh\codex_deploy_ed25519",
  [ValidateSet('/root/tdata')][string]$RemoteDir = '/root/tdata',
  [ValidateSet('web')][string]$Service = 'web',
  [ValidatePattern('^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$')][string]$Image,
  [ValidateRange(10,600)][int]$HealthTimeoutSeconds = 90,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'

# План доступен без SSH; Apply — отдельное явное действие оператора.
if (-not $Image) { throw 'Pass -Image with the immutable registry digest (repository@sha256:...).'}
Write-Host "TData deploy plan: ${User}@${HostName} ${RemoteDir}, compose=tdata, web+tline-worker, loopback3010."
Write-Host 'Inventory -> ownership -> migration preflight -> verified DB backup -> recreate -> health -> image rollback on failure.'
if (-not $Apply) { Write-Host 'Dry run. No connection or changes. Pass -Apply to execute this plan.'; return }
if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw 'SSH key is missing. Pass -KeyPath to an existing private key.' }

$template = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'deploy/remote-redeploy.sh') -Raw
$remoteScript = "TDATA_DEPLOY_DIR='$RemoteDir'`nTDATA_DEPLOY_IMAGE='$Image'`nTDATA_DEPLOY_TIMEOUT='$HealthTimeoutSeconds'`n$template"
$sshOptions = @('-i', $KeyPath, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15')
$remoteScript.Replace("`r`n", "`n") | & ssh @sshOptions "${User}@${HostName}" 'bash -s'
if ($LASTEXITCODE -ne 0) { throw 'TData deployment failed. Review the reported stage; no success is claimed.' }
Write-Host 'TData deployment passed the local service health check.'
