# Create the MonitoringAI camera record for the local webcam (idempotent).
# Uses the same DB credentials as backend/.env by default.
param(
    [string]$PgUser     = "monitoring",
    [string]$PgPassword = "monitoring_pass",
    [string]$PgHost     = "localhost",
    [int]   $PgPort     = 5432,
    [string]$PgDatabase = "smart_monitoring"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$sql = Join-Path $root "sql\link_monitoring_camera.sql"

$psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $psql) {
    $psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
}
if (-not (Test-Path $psql)) {
    Write-Error "psql not found. Pass the full path or add PostgreSQL bin\ to PATH."
    exit 1
}

$env:PGPASSWORD = $PgPassword
& $psql -U $PgUser -h $PgHost -p $PgPort -d $PgDatabase -f $sql
Write-Host "MonitoringAI camera 'laptop_webcam' linked." -ForegroundColor Green
