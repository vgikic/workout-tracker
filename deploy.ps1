# One-time setup: create the GitHub repos, push the code, enable GitHub Pages.
# Prerequisite: `gh auth login` (browser login) done once on this machine.
# Safe to re-run: every step checks whether it is already done.

$ErrorActionPreference = 'Stop'
$owner    = 'vgikic'
$codeRepo = 'workout-tracker'
$dataRepo = 'workout-data'
$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataDir  = Join-Path (Split-Path -Parent $here) $dataRepo

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) { $gh = "C:\Program Files\GitHub CLI\gh.exe" } else { $gh = $gh.Source }
if (-not (Test-Path $gh)) { throw "GitHub CLI not found. Install with: winget install GitHub.cli" }

& $gh auth status 2>$null
if ($LASTEXITCODE -ne 0) { throw "Not logged in. Run:  gh auth login   (choose GitHub.com, HTTPS, login with browser) and re-run this script." }

function RepoExists($name) { & $gh repo view "$owner/$name" 2>$null | Out-Null; return $LASTEXITCODE -eq 0 }

# ---- 1. public code repo ------------------------------------------------------
Set-Location $here
if (-not (RepoExists $codeRepo)) {
  Write-Host "Creating public repo $owner/$codeRepo"
  & $gh repo create "$owner/$codeRepo" --public --description "Lift Log - personal workout & body weight tracker (PWA)" | Out-Null
} else { Write-Host "Repo $owner/$codeRepo exists" }

if (-not (git remote 2>$null | Select-String -SimpleMatch 'origin')) {
  git remote add origin "https://github.com/$owner/$codeRepo.git"
}
git branch -M main 2>$null
if (git status --porcelain) { git add -A; git commit -m "Update" | Out-Null }
Write-Host "Pushing code"
git push -u origin main

# ---- 2. GitHub Pages ------------------------------------------------------------
& $gh api "repos/$owner/$codeRepo/pages" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Enabling GitHub Pages (main branch, root)"
  & $gh api --method POST "repos/$owner/$codeRepo/pages" -f "source[branch]=main" -f "source[path]=/" | Out-Null
} else { Write-Host "GitHub Pages already enabled" }

# ---- 3. private data repo with an empty data.json -------------------------------
if (-not (RepoExists $dataRepo)) {
  Write-Host "Creating private repo $owner/$dataRepo"
  & $gh repo create "$owner/$dataRepo" --private --description "Lift Log data (private)" | Out-Null
} else { Write-Host "Repo $owner/$dataRepo exists" }

New-Item -ItemType Directory -Force $dataDir | Out-Null
Set-Location $dataDir
if (-not (Test-Path (Join-Path $dataDir '.git'))) { git init | Out-Null; git branch -M main 2>$null }
if (-not (git remote 2>$null | Select-String -SimpleMatch 'origin')) { git remote add origin "https://github.com/$owner/$dataRepo.git" }
git fetch origin main 2>$null
if ($LASTEXITCODE -eq 0) {
  git reset --hard origin/main | Out-Null
  Write-Host "Data repo already has content"
} else {
  if (-not (Test-Path 'data.json')) {
    @'
{
  "version": 1,
  "templates": [],
  "sessions": [],
  "weights": []
}
'@ | Set-Content -Encoding UTF8 -NoNewline 'data.json'
  }
  if (-not (Test-Path 'README.md')) { "# workout-data`n`nPrivate data for Lift Log. Written by the app via the GitHub API." | Set-Content -Encoding UTF8 'README.md' }
  git add -A; git commit -m "Initial empty data" | Out-Null
  git push -u origin main
}
Set-Location $here

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "App URL (Pages can take a minute on first deploy): https://$owner.github.io/$codeRepo/"
Write-Host "Next: create a fine-grained token for $owner/$dataRepo (Contents: read & write) at"
Write-Host "      https://github.com/settings/personal-access-tokens/new"
Write-Host "      and paste it into the app under Settings -> Backup & sync."
