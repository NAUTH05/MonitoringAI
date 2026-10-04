#Requires -Version 5.1
<#
.SYNOPSIS
  Idempotent LOCAL PostgreSQL bootstrap for MonitoringAI + AI-Cam (Windows).

.DESCRIPTION
  Verifies PostgreSQL, creates any MISSING databases/roles, applies the
  MonitoringAI Prisma schema, applies the AI-Cam schema, optionally seeds and
  optionally links the local development camera. It NEVER drops a database and
  never overwrites a working schema.

  Safe to run repeatedly: running it twice does not destroy existing data.

.PARAMETER SuperPassword
  Password of the PostgreSQL superuser (default user: postgres). If omitted,
  $env:PGPASSWORD is used, otherwise you are prompted. The password is never
  written to disk by this script.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-postgres.ps1 -Seed

.EXAMPLE
  # First time, if you do not know the postgres password:
  powershell -ExecutionPolicy Bypass -File .\ai-cam\scripts\reset_postgres_password.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-postgres.ps1 -Seed -LinkDevCamera
#>
[CmdletBinding()]
param(
    [string]$PgHost       = "127.0.0.1",
    [int]   $PgPort       = 5432,
    [string]$SuperUser    = "postgres",
    [string]$SuperPassword,
    [string]$AppUser      = "monitoring",
    [string]$AppPassword  = "monitoring_pass",
    [string]$MonitoringDb = "smart_monitoring",
    [string]$AicamDb      = "aicam",
    [switch]$Seed,
    [switch]$LinkDevCamera,
    [switch]$SkipPrisma,
    [switch]$SkipAicam
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
$backendDir = Join-Path $root "backend"
$aiCamDir   = Join-Path $root "ai-cam"

function Write-Head($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }
function Write-Ok($t)   { Write-Host "  [OK]   $t" -ForegroundColor Green }
function Write-Warn2($t){ Write-Host "  [WARN] $t" -ForegroundColor Yellow }
function Write-Err2($t) { Write-Host "  [FAIL] $t" -ForegroundColor Red }

# ── 1. locate psql ────────────────────────────────────────────────────────
Write-Head "1. Locate psql"
$psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $psql) {
    foreach ($v in @("16","15","17","14")) {
        $cand = "C:\Program Files\PostgreSQL\$v\bin\psql.exe"
        if (Test-Path $cand) { $psql = $cand; break }
    }
}
if (-not $psql) {
    Write-Err2 "psql not found. Install PostgreSQL or add its bin\ folder to PATH."
    exit 1
}
Write-Ok "psql: $psql"
$ver = (& $psql --version) 2>&1
Write-Ok $ver

# ── 2. resolve superuser password ─────────────────────────────────────────
Write-Head "2. Superuser credentials"
if (-not $SuperPassword) { $SuperPassword = $env:PGPASSWORD }
if (-not $SuperPassword) {
    $sec = Read-Host -Prompt "PostgreSQL superuser ($SuperUser) password" -AsSecureString
    $SuperPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
$env:PGPASSWORD = $SuperPassword

# ── 3. verify connection ──────────────────────────────────────────────────
Write-Head "3. Verify connection to ${PgHost}:${PgPort}"
$serverVersion = (& $psql -U $SuperUser -h $PgHost -p $PgPort -d postgres -tAc "SELECT version();") 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Err2 "Cannot connect as '$SuperUser' to ${PgHost}:${PgPort}."
    Write-Host "        - Is the PostgreSQL service running?" -ForegroundColor Yellow
    Write-Host "        - Wrong password? Run: ai-cam\scripts\reset_postgres_password.ps1" -ForegroundColor Yellow
    exit 1
}
Write-Ok $serverVersion

# ── 4. ensure the application role exists ─────────────────────────────────
Write-Head "4. Ensure role '$AppUser' exists"
$roleSql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$AppUser') THEN
    CREATE ROLE "$AppUser" LOGIN PASSWORD '$AppPassword';
  END IF;
END
`$`$;
"@
& $psql -U $SuperUser -h $PgHost -p $PgPort -d postgres -v ON_ERROR_STOP=1 -c $roleSql | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Err2 "Failed to ensure role '$AppUser'."; exit 1 }
Write-Ok "role '$AppUser' present"

# ── 5. ensure databases exist (never drop) ────────────────────────────────
Write-Head "5. Ensure databases exist"
function Ensure-Db([string]$name) {
    $exists = (& $psql -U $SuperUser -h $PgHost -p $PgPort -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$name';") 2>&1
    if ($exists.Trim() -eq "1") {
        Write-Ok "database '$name' already exists (left untouched)"
    } else {
        & $psql -U $SuperUser -h $PgHost -p $PgPort -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE `"$name`" OWNER `"$AppUser`";" | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Err2 "Failed to create database '$name'."; exit 1 }
        & $psql -U $SuperUser -h $PgHost -p $PgPort -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE `"$name`" TO `"$AppUser`";" | Out-Null
        Write-Ok "database '$name' created (owner=$AppUser)"
    }
}
Ensure-Db $MonitoringDb
if (-not $SkipAicam) { Ensure-Db $AicamDb }

# ── 6. MonitoringAI Prisma schema ─────────────────────────────────────────
if (-not $SkipPrisma) {
    Write-Head "6. MonitoringAI Prisma schema"
    if (-not (Test-Path (Join-Path $backendDir "node_modules"))) {
        Write-Warn2 "backend\node_modules missing -> running 'npm install'"
        Push-Location $backendDir; & npm install; Pop-Location
    }
    $env:DATABASE_URL = "postgresql://$AppUser`:$AppPassword@$PgHost`:$PgPort/$MonitoringDb"
    Push-Location $backendDir
    try {
        & npx prisma generate
        if ($LASTEXITCODE -ne 0) { Write-Err2 "prisma generate failed."; exit 1 }
        Write-Ok "prisma generate"
        & npx prisma db push
        if ($LASTEXITCODE -ne 0) {
            Write-Err2 "prisma db push failed (schema drift?). Review the output above."
            exit 1
        }
        Write-Ok "prisma db push (schema applied, no data dropped)"
        if ($Seed) {
            & npm run db:seed
            if ($LASTEXITCODE -ne 0) { Write-Warn2 "seed failed (see output above)" }
            else { Write-Ok "seed complete (development data)" }
        } else {
            Write-Warn2 "seed skipped (pass -Seed to create dev users/modules/cameras)"
        }
    } finally { Pop-Location }
}

# ── 7. AI-Cam schema ──────────────────────────────────────────────────────
if (-not $SkipAicam) {
    Write-Head "7. AI-Cam schema"
    $schemaFile = Join-Path $aiCamDir "sql\aicam_schema.sql"
    if (-not (Test-Path $schemaFile)) {
        Write-Warn2 "schema file not found: $schemaFile (skipped)"
    } else {
        $env:PGPASSWORD = $AppPassword
        & $psql -U $AppUser -h $PgHost -p $PgPort -d $AicamDb -v ON_ERROR_STOP=1 -f $schemaFile | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warn2 "failed to apply AI-Cam schema" }
        else { Write-Ok "AI-Cam schema applied (events, streams)" }
        $env:PGPASSWORD = $SuperPassword
    }
}

# ── 8. optional development camera ────────────────────────────────────────
if ($LinkDevCamera) {
    Write-Head "8. Link local development camera"
    $linkSql = Join-Path $aiCamDir "sql\link_monitoring_camera.sql"
    $env:PGPASSWORD = $AppPassword
    & $psql -U $AppUser -h $PgHost -p $PgPort -d $MonitoringDb -v ON_ERROR_STOP=1 -f $linkSql | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warn2 "camera link failed" } else { Write-Ok "camera 'Laptop Webcam' ensured" }
    # Assign the INTRUSION module to that camera (idempotent).
    $assignSql = @"
INSERT INTO camera_modules (id, camera_id, module_id, is_enabled, created_at)
SELECT gen_random_uuid(), c.id, m.id, true, now()
FROM cameras c, ai_modules m
WHERE c.name = 'Laptop Webcam' AND m.code = 'INTRUSION'
  AND NOT EXISTS (
    SELECT 1 FROM camera_modules cm WHERE cm.camera_id = c.id AND cm.module_id = m.id
  );
"@
    & $psql -U $AppUser -h $PgHost -p $PgPort -d $MonitoringDb -v ON_ERROR_STOP=1 -c $assignSql | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warn2 "INTRUSION assignment failed" } else { Write-Ok "INTRUSION assigned to 'Laptop Webcam'" }
    $env:PGPASSWORD = $SuperPassword
}

# ── 9. health summary ─────────────────────────────────────────────────────
Write-Head "9. Health summary"
$env:PGPASSWORD = $AppPassword
Write-Host "  Databases:"
& $psql -U $AppUser -h $PgHost -p $PgPort -d postgres -tAc "SELECT datname FROM pg_database WHERE datname IN ('$MonitoringDb','$AicamDb') ORDER BY datname;" 2>&1 |
    ForEach-Object { if ("$_".Trim()) { Write-Host "    - $_" } }

Write-Host "  MonitoringAI tables:"
& $psql -U $AppUser -h $PgHost -p $PgPort -d $MonitoringDb -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" 2>&1 |
    ForEach-Object { if ("$_".Trim()) { Write-Host "    - $_" } }

if (-not $SkipAicam) {
    Write-Host "  AI-Cam tables:"
    & $psql -U $AppUser -h $PgHost -p $PgPort -d $AicamDb -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" 2>&1 |
        ForEach-Object { if ("$_".Trim()) { Write-Host "    - $_" } }
}

$intrusion = (& $psql -U $AppUser -h $PgHost -p $PgPort -d $MonitoringDb -tAc "SELECT COUNT(*) FROM ai_modules WHERE code='INTRUSION';" 2>&1)
if ("$intrusion".Trim() -eq "1") { Write-Ok "INTRUSION module present" }
else { Write-Warn2 "INTRUSION module missing -> run with -Seed" }

$env:PGPASSWORD = $null
Write-Head "Done"
Write-Host "Next:"
Write-Host "  1) copy backend\.env.example -> backend\.env   and set DATABASE_URL / AICAM_DATABASE_URL"
Write-Host "  2) copy ai-cam\.env.example  -> ai-cam\.env"
Write-Host "  3) cd backend  && npm run dev"
Write-Host "  4) cd frontend && npm run dev"
Write-Host "  5) .\go2rtc.exe   (Terminal 4)"
Write-Host "  6) cd ai-cam && .\.venv\Scripts\python.exe main.py   (AI_TASK_NAME=intrusion)"
Write-Host ""
Write-Host "See README.md -> 'Windows Local PostgreSQL Setup' and 'Intrusion Detection Development'."
