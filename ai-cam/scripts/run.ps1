# Start the AI-Cam runtime using the project virtualenv.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $py)) {
    Write-Error "Virtualenv not found at $py. Create it first (see ai-cam\README.md)."
    exit 1
}

Push-Location $root
try {
    & $py "main.py"
} finally {
    Pop-Location
}
