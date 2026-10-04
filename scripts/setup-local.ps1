#Requires -Version 5.1
<#
.SYNOPSIS
  One-time local setup for MonitoringAI (Windows 11).

.DESCRIPTION
  Verifies the toolchain, initialises the database/schema, installs missing
  dependencies and prepares the .env files from their examples.

  It NEVER destroys existing data: database work is delegated to
  scripts/setup-postgres.ps1, which only creates what is missing.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1 -Seed

.EXAMPLE
  # Skip the database step (already initialised):
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1 -SkipDb
#>
[CmdletBinding()]
param(
    [switch]$SkipNpm,
    [switch]$SkipDb,
    [switch]$Seed,
    [switch]$LinkDevCamera
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

function Write-Head($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }
function Write-Ok($t)   { Write-Host "  [OK]   $t" -ForegroundColor Green }
function Write-Warn2($t){ Write-Host "  [WARN] $t" -ForegroundColor Yellow }
function Write-Err2($t) { Write-Host "  [FAIL] $t" -ForegroundColor Red }

function Test-Port([int]$Port) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect("127.0.0.1", $Port)
        $c.Close()
        return $true
    } catch { return $false }
}

Write-Host ""
Write-Host "MonitoringAI - local setup" -ForegroundColor White
Write-Host "repo: $root" -ForegroundColor DarkGray

# ── 1. toolchain ──────────────────────────────────────────────────────────
Write-Head "1. Toolchain"
$node = (Get-Command node -ErrorAction SilentlyContinue)
if ($node) { Write-Ok ("node {0}" -f (& node --version)) } else { Write-Err2 "Node.js 20+ not found (install from nodejs.org)"; exit 1 }

if (Get-Command npm -ErrorAction SilentlyContinue) { Write-Ok "npm present" } else { Write-Err2 "npm not found"; exit 1 }

$venvPython = Join-Path $root "ai-cam\.venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    Write-Ok "ai-cam venv present"
} else {
    Write-Warn2 "ai-cam\.venv missing -> create it with:"
    Write-Host "          cd ai-cam; python -m venv .venv" -ForegroundColor DarkGray
    Write-Host "          .\.venv\Scripts\python.exe -m pip install -r requirements.txt" -ForegroundColor DarkGray
}

if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    Write-Ok ("ffmpeg {0}" -f ((& ffmpeg -version 2>&1 | Select-Object -First 1) -replace '\s+.*$',''))
} else {
    Write-Warn2 "ffmpeg not on PATH - needed by go2rtc for webcam capture + H265 transcode"
}

$go2rtc = Join-Path $root "go2rtc.exe"
if (Test-Path $go2rtc) { Write-Ok "go2rtc.exe present" } else { Write-Warn2 "go2rtc.exe not found at repo root" }

# ── 2. env files ──────────────────────────────────────────────────────────
Write-Head "2. Environment files"
$envPairs = @(
    @{ dst = "backend\.env";      src = "backend\.env.example" },
    @{ dst = "ai-cam\.env";       src = "ai-cam\.env.example" },
    @{ dst = "frontend\.env.local"; src = "frontend\.env.local.example" }
)
foreach ($pair in $envPairs) {
    $dst = Join-Path $root $pair.dst
    $src = Join-Path $root $pair.src
    if (Test-Path $dst) {
        Write-Ok "$($pair.dst) present (left untouched)"
    } elseif (Test-Path $src) {
        Copy-Item $src $dst
        Write-Ok "$($pair.dst) created from example"
    } else {
        Write-Warn2 "$($pair.dst) missing and no example found"
    }
}

# ── 3. dependencies ───────────────────────────────────────────────────────
if (-not $SkipNpm) {
    Write-Head "3. Node dependencies"
    foreach ($pkg in @("backend", "frontend")) {
        $dir = Join-Path $root $pkg
        if (Test-Path (Join-Path $dir "node_modules")) {
            Write-Ok "$pkg\node_modules present"
        } else {
            Write-Warn2 "$pkg\node_modules missing -> running npm install"
            Push-Location $dir; & npm install; Pop-Location
        }
    }
} else {
    Write-Head "3. Node dependencies (skipped)"
}

# ── 4. database ───────────────────────────────────────────────────────────
if (-not $SkipDb) {
    Write-Head "4. Database"
    $setupDb = Join-Path $PSScriptRoot "setup-postgres.ps1"
    if (Test-Path $setupDb) {
        $dbArgs = @("-ExecutionPolicy", "Bypass", "-File", $setupDb)
        if ($Seed) { $dbArgs += "-Seed" }
        if ($LinkDevCamera) { $dbArgs += "-LinkDevCamera" }
        & powershell @dbArgs
    } else {
        Write-Warn2 "scripts\setup-postgres.ps1 not found; skipping database setup"
    }
} else {
    Write-Head "4. Database (skipped)"
}

# ── 5. done ───────────────────────────────────────────────────────────────
Write-Head "Done"
Write-Host "  Next:  .\scripts\start-local.ps1" -ForegroundColor White
Write-Host ""
Write-Host "  Then, in the dashboard:" -ForegroundColor DarkGray
Write-Host "    1) log in   2) Add Camera   3) pick a source   4) Test connection" -ForegroundColor DarkGray
Write-Host "    5) assign AI modules   6) draw the restricted zone   7) watch alerts" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  You do NOT edit go2rtc.yaml or per-camera .env values." -ForegroundColor DarkGray
