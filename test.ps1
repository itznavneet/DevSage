$ErrorActionPreference = "Stop"

Push-Location (Join-Path $PSScriptRoot "services/api")
try {
  npm.cmd test
} finally {
  Pop-Location
}

$python = Join-Path $PSScriptRoot "services/ai/.venv/Scripts/python.exe"
if (-not (Test-Path $python)) {
  throw "AI virtualenv Python was not found at $python"
}

Push-Location (Join-Path $PSScriptRoot "services/ai")
try {
  & $python -m unittest discover -s tests -p "test_*.py"
} finally {
  Pop-Location
}
