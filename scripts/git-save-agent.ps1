param(
  [string]$Message = "Save TData project state",
  [string]$RemoteName = "origin",
  [string]$RemoteUrl = "https://github.com/inftverezovsky/TData.git",
  [string]$Branch = "main",
  [string]$GitUserName = "inftverezovsky",
  [string]$GitUserEmail = "inf.tverezovsky@gmail.com",
  [switch]$NoPush,
  [switch]$IncludeNestedRepos
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Git {
  git @args
  if ($LASTEXITCODE -ne 0) {
    throw "git $($args -join ' ') failed with exit code $LASTEXITCODE"
  }
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $ProjectRoot

Invoke-Git rev-parse --is-inside-work-tree | Out-Null

$topLevel = [System.IO.Path]::GetFullPath((git rev-parse --show-toplevel).Trim()).TrimEnd("\", "/")
$expectedRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd("\", "/")
if (-not [string]::Equals($topLevel, $expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Save agent must be run from the TData project root. Expected $expectedRoot, got $topLevel."
}

git config user.name $GitUserName
git config user.email $GitUserEmail

$existingRemote = git remote get-url $RemoteName 2>$null
if ($LASTEXITCODE -ne 0) {
  Invoke-Git remote add $RemoteName $RemoteUrl
} elseif ($existingRemote.Trim() -ne $RemoteUrl) {
  Invoke-Git remote set-url $RemoteName $RemoteUrl
}

Write-Host "==> Staging TData changes..." -ForegroundColor Cyan
if ($IncludeNestedRepos) {
  Invoke-Git add -A -- .
  Invoke-Git add -A -f -- TData
} else {
  Invoke-Git add -A -- .
}

$staged = git diff --cached --name-status
if (-not $staged) {
  Write-Host "==> No staged changes to commit." -ForegroundColor Yellow
} else {
  Write-Host "==> Staged files:" -ForegroundColor Cyan
  $staged | ForEach-Object { Write-Host "    $_" }
  Invoke-Git commit -m $Message
}

if ($NoPush) {
  Write-Host "==> Commit step complete. Push skipped because -NoPush was provided." -ForegroundColor Yellow
  exit 0
}

Write-Host "==> Pushing HEAD to $RemoteName/$Branch..." -ForegroundColor Cyan
Invoke-Git push -u $RemoteName "HEAD:$Branch"

Write-Host "==> TData save agent finished successfully." -ForegroundColor Green
