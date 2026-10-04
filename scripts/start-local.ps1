#Requires -Version 5.1
<#
.SYNOPSIS
  Start the whole MonitoringAI stack locally (Windows 11) with ONE command.

.DESCRIPTION
  Starts go2rtc, the backend, the frontend and the AI-Cam runtime, waits for
  each service to answer, then prints the URLs. Each service opens in its own
  window so you can watch its logs.

  No per-camera configuration happens here - cameras are added in the UI and
  discovered by the AI runtime automatically.

.EXAMPLE
  .\scripts\start-local.ps1

.EXAMPLE
  .\scripts\start-local.ps1 -SkipAiCam -NoBrowser
#>
[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$SkipAiCam,
    [switch]$SkipFrontend,
    [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Continue"
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

function Wait-Port([int]$Port, [string]$Name, [int]$Seconds = 60) {
    for ($i = 0; $i -lt $Seconds; $i++) {
        if (Test-Port $Port) { Write-Ok "$Name is up (port $Port)"; return $true }
        Start-Sleep -Seconds 1
    }
    Write-Warn2 "$Name did not answer on port $Port within ${Seconds}s"
    return $false
}

function Start-Service-Window([string]$Title, [string]$WorkingDir, [string]$Command) {
    $line = "`$host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$WorkingDir'; $Command"
    Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $line | Out-Null
}

Write-Host ""
Write-Host "MonitoringAI - starting local stack" -ForegroundColor White

# ── preflight ─────────────────────────────────────────────────────────────
Write-Head "Preflight"
if (Test-Port 5432) { Write-Ok "PostgreSQL is running" } else { Write-Warn2 "PostgreSQL not reachable on 5432 - start it first" }

foreach ($pkg in @("backend", "frontend")) {
    if (-not (Test-Path (Join-Path $root "$pkg\node_modules"))) {
        Write-Warn2 "$pkg\node_modules missing - run .\scripts\setup-local.ps1 first"
    }
}

$venvPython = Join-Path $root "ai-cam\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython) -and -not $SkipAiCam) {
    Write-Warn2 "ai-cam\.venv missing - AI-Cam will not start"
    $SkipAiCam = $true
}
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warn2 "ffmpeg not on PATH - go2rtc webcam capture and evidence video need it"
}

# ── 1. go2rtc ─────────────────────────────────────────────────────────────
Write-Head "1. go2rtc (stream gateway)"
if (Test-Port 1984) {
    Write-Ok "go2rtc already listening on 1984"
} elseif (Test-Path (Join-Path $root "go2rtc.exe")) {
    Start-Service-Window "go2rtc" $root ".\go2rtc.exe"
    Wait-Port 1984 "go2rtc" 20 | Out-Null
} else {
    Write-Warn2 "go2rtc.exe not found at repo root"
}

# ── 2. backend ────────────────────────────────────────────────────────────
Write-Head "2. Backend"
if (Test-Port 4000) {
    Write-Ok "backend already listening on 4000"
} else {
    Start-Service-Window "MonitoringAI backend" (Join-Path $root "backend") "npm run dev"
    Wait-Port 4000 "backend" $TimeoutSeconds | Out-Null
}

# ── 3. frontend ───────────────────────────────────────────────────────────
if (-not $SkipFrontend) {
    Write-Head "3. Frontend"
    if (Test-Port 3000) {
        Write-Ok "frontend already listening on 3000"
    } else {
        Start-Service-Window "MonitoringAI frontend" (Join-Path $root "frontend") "npm run dev"
        Wait-Port 3000 "frontend" $TimeoutSeconds | Out-Null
    }
}

# ── 4. AI-Cam ─────────────────────────────────────────────────────────────
if (-not $SkipAiCam) {
    Write-Head "4. AI-Cam (multi-camera AI runtime)"
    if (Test-Port 8090) {
        Write-Ok "AI-Cam status server already listening on 8090"
    } else {
        Start-Service-Window "AI-Cam" (Join-Path $root "ai-cam") ".\.venv\Scripts\python.exe main.py"
        Wait-Port 8090 "AI-Cam" $TimeoutSeconds | Out-Null
    }
    Write-Host "  Cameras are discovered from the backend (GET /api/ai/runtime-config)." -ForegroundColor DarkGray
    Write-Host "  Add a camera in the UI - no .env edit needed." -ForegroundColor DarkGray
}

# ── URLs ──────────────────────────────────────────────────────────────────
Write-Head "Services"
Write-Host "  MonitoringAI : http://localhost:3000" -ForegroundColor White
Write-Host "  Backend      : http://localhost:4000" -ForegroundColor White
Write-Host "  go2rtc       : http://localhost:1984" -ForegroundColor White
Write-Host "  AI-Cam       : http://localhost:8090" -ForegroundColor White

if (-not $NoBrowser) {
    try { Start-Process "http://localhost:3000" | Out-Null } catch { }
}

Write-Host ""
Write-Host "  Stop everything:  .\scripts\stop-local.ps1" -ForegroundColor DarkGray
Write-Host ""
