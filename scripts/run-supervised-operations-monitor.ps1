$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repositoryRoot
try {
  if (Test-Path -LiteralPath .env) {
    Get-Content .env | Where-Object { $_ -match '^\s*[^#][^=]+=' } | ForEach-Object {
      $entryName, $entryValue = $_ -split '=', 2
      [Environment]::SetEnvironmentVariable($entryName.Trim(), $entryValue.Trim(), 'Process')
    }
  }
  npm run operations:monitor -- --max-age-ms 600000
  if ($LASTEXITCODE -ne 0) { throw "Operations monitor detected an unhealthy heartbeat." }
} finally {
  Pop-Location
}
