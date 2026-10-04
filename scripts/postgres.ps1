#Requires -Version 5.1
<#
.SYNOPSIS
  Start / stop / restart / check the local PostgreSQL service (Windows).

.DESCRIPTION
  Controlling a Windows service requires an ELEVATED shell. When the script is
  not elevated it prints the exact command to run as Administrator and exits
  with code 2, so callers can tell "needs admin" apart from "failed".

  Exit codes:
    0 = action completed (or the service was already in the desired state)
    1 = action failed
    2 = needs Administrator
    3 = no PostgreSQL service found

.EXAMPLE
  .\scripts\postgres.ps1 status

.EXAMPLE
  # In an ADMIN PowerShell:
  .\scripts\postgres.ps1 start
  .\scripts\postgres.ps1 stop
#>
[CmdletBinding()]
param(
    [ValidateSet('status', 'start', 'stop', 'restart')]
    [string]$Action = 'status',
    [string]$ServiceName = '',
    [int]$Port = 5432
)

$ErrorActionPreference = "Continue"

function Write-Head($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }
function Write-Ok($t)   { Write-Host "  [OK]   $t" -ForegroundColor Green }
function Write-Warn2($t){ Write-Host "  [WARN] $t" -ForegroundColor Yellow }
function Write-Err2($t) { Write-Host "  [FAIL] $t" -ForegroundColor Red }

function Test-PgPort([int]$p) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect("127.0.0.1", $p)
        $c.Close()
        return $true
    } catch { return $false }
}

function Test-Admin {
    return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

function Resolve-PgService([string]$explicit) {
    if ($explicit) {
        return (Get-Service -Name $explicit -ErrorAction SilentlyContinue)
    }
    $all = Get-Service | Where-Object {
        $_.Name -like '*postgres*' -or $_.DisplayName -like '*PostgreSQL*'
    }
    if (-not $all) { return $null }
    $running = $all | Where-Object { $_.Status -eq 'Running' } | Select-Object -First 1
    if ($running) { return $running }
    return ($all | Select-Object -First 1)
}

function Wait-PgPort([int]$p, [int]$seconds = 30) {
    for ($i = 0; $i -lt $seconds; $i++) {
        if (Test-PgPort $p) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Write-NeedsAdmin([string]$verb) {
    Write-Warn2 "Not elevated - Windows service control needs Administrator."
    Write-Host "  Open PowerShell as Administrator, then run:" -ForegroundColor Yellow
    Write-Host "    $verb-Service $($script:service.Name)" -ForegroundColor White
    Write-Host "  (or: .\scripts\postgres.ps1 $Action)" -ForegroundColor DarkGray
}

$script:service = Resolve-PgService $ServiceName
if (-not $script:service) {
    Write-Err2 "No PostgreSQL service found. Pass -ServiceName <name> if it is named unusually."
    exit 3
}

switch ($Action) {
    'status' {
        Write-Head "PostgreSQL status"
        Write-Host "  service : $($script:service.Name)" -ForegroundColor Gray
        Write-Host "  display : $($script:service.DisplayName)" -ForegroundColor Gray
        Write-Host "  state   : $($script:service.Status)  (start type: $($script:service.StartType))" -ForegroundColor Gray
        if (Test-PgPort $Port) {
            Write-Ok "port $Port is accepting connections"
            exit 0
        }
        Write-Warn2 "port $Port is NOT listening"
        exit 1
    }

    'start' {
        Write-Head "Start PostgreSQL"
        if ($script:service.Status -eq 'Running' -and (Test-PgPort $Port)) {
            Write-Ok "$($script:service.Name) is already running (port $Port up)"
            exit 0
        }
        if (-not (Test-Admin)) { Write-NeedsAdmin "Start"; exit 2 }
        try {
            Start-Service -Name $script:service.Name -ErrorAction Stop
            if (Wait-PgPort $Port) {
                Write-Ok "$($script:service.Name) started (port $Port up)"
                exit 0
            }
            Write-Warn2 "$($script:service.Name) started but port $Port is not answering yet"
            exit 1
        } catch {
            Write-Err2 "Failed to start $($script:service.Name): $($_.Exception.Message)"
            exit 1
        }
    }

    'stop' {
        Write-Head "Stop PostgreSQL"
        if ($script:service.Status -ne 'Running') {
            Write-Ok "$($script:service.Name) is already stopped"
            exit 0
        }
        if (-not (Test-Admin)) { Write-NeedsAdmin "Stop"; exit 2 }
        try {
            Stop-Service -Name $script:service.Name -Force -ErrorAction Stop
            Write-Ok "$($script:service.Name) stopped"
            exit 0
        } catch {
            Write-Err2 "Failed to stop $($script:service.Name): $($_.Exception.Message)"
            exit 1
        }
    }

    'restart' {
        Write-Head "Restart PostgreSQL"
        if (-not (Test-Admin)) { Write-NeedsAdmin "Restart"; exit 2 }
        try {
            Restart-Service -Name $script:service.Name -Force -ErrorAction Stop
            if (Wait-PgPort $Port) { Write-Ok "$($script:service.Name) restarted (port $Port up)" }
            else { Write-Warn2 "$($script:service.Name) restarted but port $Port is not answering yet" }
            exit 0
        } catch {
            Write-Err2 "Failed to restart $($script:service.Name): $($_.Exception.Message)"
            exit 1
        }
    }
}
