# SGEN Migration QA — installer (Windows PowerShell)
# Verifies prerequisites, installs deps + the Chromium browser, and runs the smoke test.
# Usage:  powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "SGEN Migration QA — install" -ForegroundColor Cyan

# 1. Node >= 18
try { $nv = (node -v) -replace 'v','' } catch { Write-Host "Node.js not found. Install Node 18+ from https://nodejs.org" -ForegroundColor Red; exit 1 }
if ([int]($nv.Split('.')[0]) -lt 18) { Write-Host "Node $nv is too old — need 18+." -ForegroundColor Red; exit 1 }
Write-Host "  node $nv OK"

# 2. Dependencies (playwright + sharp)
Write-Host "  installing dependencies (npm ci)..."
if (Test-Path package-lock.json) { npm ci --omit=dev } else { npm install --omit=dev }
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed." -ForegroundColor Red; exit 1 }

# 3. Playwright browser (chromium; add 'firefox webkit' for full cross-browser Site Audit)
Write-Host "  installing Chromium (Playwright)..."
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { Write-Host "playwright install failed." -ForegroundColor Red; exit 1 }

# 4. Launcher shim: qa.cmd -> node <dir>\sgen.js
$shim = "@echo off`r`nnode `"$PSScriptRoot\sgen.js`" %*`r`n"
Set-Content -Path (Join-Path $PSScriptRoot 'qa.cmd') -Value $shim -Encoding ascii
Write-Host "  launcher written: qa.cmd  (add this folder to PATH to run 'qa' anywhere)"

# 5. Smoke test
Write-Host "  running selftest..."
node sgen-selftest.js
if ($LASTEXITCODE -ne 0) { Write-Host "`nSelftest FAILED — install is not healthy." -ForegroundColor Red; exit 1 }

Write-Host "`nInstalled. Start the app:" -ForegroundColor Green
Write-Host "    qa qa-serve        then open http://127.0.0.1:7878"
Write-Host "  Read OPERATOR-GUIDE-v1.0.md before signing off a migration."
Write-Host "  Update later with:  qa update"
