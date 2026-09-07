param([string]$Symbol = "AAPL")

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repositoryRoot
try {
  Get-Content .env | Where-Object { $_ -match '^\s*[^#][^=]+=' } | ForEach-Object {
    $entryName, $entryValue = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($entryName.Trim(), $entryValue.Trim(), 'Process')
  }
  npm run paper-trading:coordinator -- --symbols $Symbol --strategy buy-and-hold --sizing allocation --target-allocation-pct 0.001 --max-order-notional 25 --max-position-notional 100 --max-executions-per-run 1 --max-notional-per-run 25 --iterations 1 --dry-run --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
  if ($LASTEXITCODE -ne 0) { throw "Paper dry-run coordinator exited with $LASTEXITCODE." }
} finally {
  Pop-Location
}
