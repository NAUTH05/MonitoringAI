#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Reset the local PostgreSQL `postgres` superuser password and create the
  AI-Cam `aicam` database + schema.

.DESCRIPTION
  This must be run from an ELEVATED PowerShell (Run as Administrator).

  It performs a standard, minimal password-recovery procedure:
    1. backs up pg_hba.conf
    2. temporarily prepends localhost-only `trust` lines
    3. restarts PostgreSQL
    4. sets a new `postgres` password
    5. creates the `aicam` database + schema (via init_aicam_db.py)
    6. restores the original pg_hba.conf and restarts PostgreSQL again

  The trust window only applies to 127.0.0.1 / ::1 and lasts a few seconds.
  The original pg_hba.conf is always restored, even if a step fails.

.EXAMPLE
  # Elevated PowerShell
  powershell -ExecutionPolicy Bypass -File C:\Work\PROJECTS\monitoringAI\ai-cam\scripts\reset_postgres_password.ps1

.EXAMPLE
  # Use a custom new password and only reset (do not create aicam):
  ...\reset_postgres_password.ps1 -NewPassword "MyPassw0rd" -SkipDatabaseInit
#>
param(
    [string]$ServiceName = "postgresql-x64-16",
    [string]$DataDir     = "C:\Program Files\PostgreSQL\16\data",
    [string]$NewPassword = "postgres",
    [string]$AppDsn      = "postgresql://monitoring:monitoring_pass@127.0.0.1:5432/aicam",
    [switch]$SkipDatabaseInit
)

$ErrorActionPreference = "Stop"

$bin       = Join-Path (Split-Path $DataDir -Parent) "bin"
$psql      = Join-Path $bin "psql.exe"
$pgIsReady = Join-Path $bin "pg_isready.exe"
$hba       = Join-Path $DataDir "pg_hba.conf"
$backup    = "$hba.aicam-backup"
$initPy    = Join-Path $PSScriptRoot "init_aicam_db.py"
$aiCamRoot = Split-Path $PSScriptRoot -Parent
$venvPy    = Join-Path $aiCamRoot ".venv\Scripts\python.exe"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $psql))      { throw "psql.exe not found at $psql" }
if (-not (Test-Path $hba))       { throw "pg_hba.conf not found at $hba" }
if (-not (Test-Path $venvPy))    { throw "AI-Cam venv python not found at $venvPy" }

Write-Host "== AI-Cam: PostgreSQL password reset + DB init ==" -ForegroundColor Cyan
$current = (Get-Service $ServiceName).Status
Write-Host "Service $ServiceName is currently: $current"

$original = [System.IO.File]::ReadAllText($hba)
if (-not (Test-Path $backup)) {
    [System.IO.File]::WriteAllText($backup, $original, $utf8NoBom)
    Write-Host "Backed up pg_hba.conf -> $backup"
} else {
    Write-Host "Backup already exists: $backup (reusing original state from it)"
    $original = [System.IO.File]::ReadAllText($backup)
}

function Wait-Postgres {
    for ($i = 0; $i -lt 40; $i++) {
        & $pgIsReady -h 127.0.0.1 -p 5432 | Out-Null
        if ($LASTEXITCODE -eq 0) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

try {
    # 1. Temporary localhost-only trust
    $trustLines = @(
        "# --- TEMP AICAM RECOVERY (auto-removed) ---",
        "host    all             all             127.0.0.1/32            trust",
        "host    all             all             ::1/128                 trust",
        ""
    ) -join "`n"
    [System.IO.File]::WriteAllText($hba, $trustLines + $original, $utf8NoBom)
    Write-Host "Temporary trust enabled for localhost." -ForegroundColor Yellow

    # 2. Restart and wait
    Restart-Service $ServiceName -Force
    if (-not (Wait-Postgres)) { throw "PostgreSQL did not come back up after restart." }
    Write-Host "PostgreSQL restarted."

    # 3. Set the new password (piped via stdin so it is not in the process list)
    $escaped = $NewPassword.Replace("'", "''")
    "ALTER USER postgres WITH PASSWORD '$escaped';" | & $psql -U postgres -h 127.0.0.1 -p 5432 -d postgres -v ON_ERROR_STOP=1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to set the postgres password." }
    Write-Host "postgres password updated." -ForegroundColor Green

    # 4. Create the aicam database + schema
    if (-not $SkipDatabaseInit) {
        if (-not (Test-Path $initPy)) { throw "init_aicam_db.py not found at $initPy" }
        $env:PGPASSWORD = $NewPassword
        & $venvPy $initPy --admin-dsn "postgresql://postgres@127.0.0.1:5432/postgres" --app-dsn $AppDsn
        if ($LASTEXITCODE -ne 0) { throw "init_aicam_db.py failed." }
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }
}
finally {
    # 5. Always restore original auth and restart
    [System.IO.File]::WriteAllText($hba, $original, $utf8NoBom)
    Restart-Service $ServiceName -Force
    if (Wait-Postgres) {
        Write-Host "Original pg_hba.conf restored and PostgreSQL restarted." -ForegroundColor Green
    } else {
        Write-Warning "PostgreSQL did not report ready after restore; check the service."
    }
}

# 6. Verify the new password works with normal (scram) auth
$env:PGPASSWORD = $NewPassword
& $psql -U postgres -h 127.0.0.1 -p 5432 -d postgres -tAc "SELECT 'postgres login OK';" 2>&1 | Write-Host
if (-not $SkipDatabaseInit) {
    & $psql -U postgres -h 127.0.0.1 -p 5432 -d aicam -tAc "SELECT 'aicam tables: ' || string_agg(table_name,', ') FROM information_schema.tables WHERE table_schema='public';" 2>&1 | Write-Host
}
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "DONE. New postgres password: (the value you passed, default 'postgres')" -ForegroundColor Cyan
Write-Host "pg_hba.conf backup kept at: $backup"
