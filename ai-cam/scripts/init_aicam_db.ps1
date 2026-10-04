# Create the local AI-Cam PostgreSQL database + schema.
# Prompts for the PostgreSQL superuser (postgres) password.
param(
    [string]$AdminDsn = "postgresql://postgres@localhost:5432/postgres",
    [string]$AppDsn   = "postgresql://monitoring:monitoring_pass@localhost:5432/aicam"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $py)) {
    Write-Error "Virtualenv not found at $py. Create it first (see ai-cam\README.md)."
    exit 1
}

& $py (Join-Path $root "scripts\init_aicam_db.py") --admin-dsn $AdminDsn --app-dsn $AppDsn
