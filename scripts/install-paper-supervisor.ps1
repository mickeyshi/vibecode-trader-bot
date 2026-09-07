param([switch]$Apply, [string]$Symbol = "AAPL")

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$dryRunScript = Join-Path $PSScriptRoot "run-supervised-paper-dry-run.ps1"
$monitorScript = Join-Path $PSScriptRoot "run-supervised-operations-monitor.ps1"
$plan = @{
  DryRunTask = "TradingBot-Paper-DryRun"
  DryRunSchedule = "Weekdays at 09:35 local; hard-coded --dry-run and normal session guards"
  MonitorTask = "TradingBot-Operations-Monitor"
  MonitorSchedule = "Daily at 16:15 local; read-only heartbeat check"
  Repository = $repositoryRoot
}

if (-not $Apply) {
  $plan | ConvertTo-Json
  Write-Output "Preview only. Re-run with -Apply to register these non-submitting tasks."
  exit 0
}

$powerShell = (Get-Command powershell.exe).Source
$dryRunAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$dryRunScript`" -Symbol `"$Symbol`"" -WorkingDirectory $repositoryRoot
$monitorAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$monitorScript`"" -WorkingDirectory $repositoryRoot
$dryRunTriggers = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday") | ForEach-Object {
  New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $_ -At "09:35"
}
$monitorTrigger = New-ScheduledTaskTrigger -Daily -At "16:15"
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $plan.DryRunTask -Action $dryRunAction -Trigger $dryRunTriggers -Settings $settings -Description "Guarded Alpaca paper coordinator dry run; never submits orders." -Force | Out-Null
Register-ScheduledTask -TaskName $plan.MonitorTask -Action $monitorAction -Trigger $monitorTrigger -Settings $settings -Description "Read-only trading-bot heartbeat monitor." -Force | Out-Null
$plan | ConvertTo-Json
