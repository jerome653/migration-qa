# SGEN Migration QA — one-line bootstrap installer.
# Fetches the tool (git clone if available, else ZIP download), then runs install.ps1.
# Run with:
#   irm https://raw.githubusercontent.com/jerome653/migration-qa/main/bootstrap.ps1 | iex
$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/jerome653/migration-qa'
$dir  = Join-Path (Get-Location) 'migration-qa'

Write-Host "SGEN Migration QA — bootstrap" -ForegroundColor Cyan

# 1. Node 18+
try { $nv = (node -v) -replace 'v','' } catch { Write-Host "Node.js not found. Install Node 18+ from https://nodejs.org, then re-run." -ForegroundColor Red; return }
if ([int]($nv.Split('.')[0]) -lt 18) { Write-Host "Node $nv is too old — need 18+." -ForegroundColor Red; return }
Write-Host "  node $nv OK"

# 2. Fetch (update if already present)
if (Test-Path $dir) {
  Write-Host "  migration-qa already here — updating"
  Push-Location $dir; git pull --ff-only 2>$null; Pop-Location
} elseif (Get-Command git -ErrorAction SilentlyContinue) {
  Write-Host "  cloning..."; git clone "$repo.git" $dir
} else {
  Write-Host "  downloading ZIP (git not found)..."
  $zip = Join-Path $env:TEMP 'migration-qa.zip'
  Invoke-WebRequest "$repo/archive/refs/heads/main.zip" -OutFile $zip
  Expand-Archive $zip -DestinationPath $env:TEMP -Force
  Move-Item (Join-Path $env:TEMP 'migration-qa-main') $dir
  Remove-Item $zip -Force
}

# 3. Install (deps + browser + selftest + launcher)
Set-Location $dir
powershell -ExecutionPolicy Bypass -File .\install.ps1

Write-Host "`nStart it:  .\qa.cmd qa-serve   ->  http://127.0.0.1:7878" -ForegroundColor Green
