#Requires -Version 5.1
<#
.SYNOPSIS
  Stop the local MonitoringAI stack started by scripts/start-local.ps1.

.DESCRIPTION
  Finds the processes listening on the dev ports (3000 frontend, 4000 backend,
  1984 go2rtc, 8090 AI-Cam) and stops them. Shows what it will stop and asks
  for confirmation unless -Force is given.

  PostgreSQL is a Windows SERVICE, not one of those processes, so it is left
  running unless you pass -IncludePostgres. Stopping the service needs an
  ELEVATED shell.

.EXAMPLE
  .\scripts\stop-local.ps1

.EXAMPLE
  # Also stop PostgreSQL (run PowerShell as Administrator):
  .\scripts\stop-local.ps1 -IncludePostgres -Force
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$IncludePostgres,
    [int[]]$Ports = @(3000, 4000, 1984, 8090)
)

$ErrorActionPreference = "Continue"

function Write-Head($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }
function Write-Ok($t)   { Write-Host "  [OK]   $t" -ForegroundColor Green }
function Write-Warn2($t){ Write-Host "  [WARN] $t" -ForegroundColor Yellow }

function Get-ListeningPids([int]$Port) {
    $pids = @()
    try {
        $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique
    } catch {
        # Fallback: parse netstat (works without the NetTCPIP module).
        $lines = netstat -ano | Select-String -Pattern ":$Port\s+.*LISTENING"
        foreach ($line in $lines) {
            $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne "" }
            if ($parts.Count -ge 5) { $pids += [int]$parts[-1] }
        }
        $pids = $pids | Select-Object -Unique
    }
    return @($pids)
}

Write-Host ""
Write-Host "MonitoringAI - stopping local stack" -ForegroundColor White

$targets = @{}
foreach ($port in $Ports) {
    foreach ($procId in (Get-ListeningPids $port)) {
        if ($procId -and $procId -gt 0) {
            if (-not $targets.ContainsKey($procId)) { $targets[$procId] = @() }
            $targets[$procId] += $port
        }
    }
}

if ($targets.Count -eq 0) {
    Write-Head "App services"
    Write-Ok "No services listening on $($Ports -join ', ')"
    $targets = @{}
}

if ($targets.Count -gt 0) {
    Write-Head "Processes to stop"
    foreach ($procId in $targets.Keys) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { "unknown" }
        Write-Host ("  pid {0,-7} {1,-20} ports {2}" -f $procId, $name, ($targets[$procId] -join ", ")) -ForegroundColor Gray
    }

    if (-not $Force) {
        $answer = Read-Host "Stop these processes? [y/N]"
        if ($answer -notmatch '^[Yy]') {
            Write-Warn2 "Aborted - nothing was stopped"
            Write-Host ""
            exit 0
        }
    }

    Write-Head "Stopping"
    foreach ($procId in $targets.Keys) {
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Ok "stopped pid $procId"
        } catch {
            Write-Warn2 "could not stop pid ${procId}: $($_.Exception.Message)"
        }
    }
}

# PostgreSQL is a Windows service (not one of the ports above) — opt in.
if ($IncludePostgres) {
    Write-Head "PostgreSQL"
    $pgScript = Join-Path $PSScriptRoot "postgres.ps1"
    if (Test-Path $pgScript) {
        & powershell -ExecutionPolicy Bypass -File $pgScript -Action stop
        if ($LASTEXITCODE -eq 2) {
            Write-Warn2 "PostgreSQL needs Administrator - run this script from an admin shell"
        }
    } else {
        Write-Warn2 "scripts\postgres.ps1 not found - stop PostgreSQL manually"
    }
} else {
    Write-Host ""
    Write-Host "  PostgreSQL left running (pass -IncludePostgres to stop it)." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Done." -ForegroundColor White
Write-Host ""
