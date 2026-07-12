#Requires -Version 5.1
<#
.SYNOPSIS
  Keep this Windows PC awake and ping Open Jarvis every 2 minutes.

.DESCRIPTION
  - Prevents sleep/display-off via Win32 SetThreadExecutionState while running
  - Optionally sets AC standby/monitor timeouts to 0 (use -SetPowerPlan)
  - Every 2 minutes: hits /api/health and /api/cron/system so the machine
    stays busy and you can confirm Status Auto-Approve / DB Consistency jobs

.EXAMPLE
  # From an elevated or normal PowerShell while the API is running:
  .\scripts\keep-awake.ps1

  # Custom API URL + also pin power plan:
  .\scripts\keep-awake.ps1 -BaseUrl http://127.0.0.1:3001 -SetPowerPlan

  # Check interval override (seconds; default 120 = 2 minutes):
  .\scripts\keep-awake.ps1 -IntervalSeconds 120
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = $(if ($env:BETTER_AUTH_URL) { $env:BETTER_AUTH_URL } else { 'http://127.0.0.1:3001' }),
  [int]$IntervalSeconds = 120,
  [switch]$SetPowerPlan,
  [switch]$NoApiPing
)

$ErrorActionPreference = 'Continue'
$BaseUrl = $BaseUrl.TrimEnd('/')

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NativeSleep {
  public const uint ES_CONTINUOUS = 0x80000000;
  public const uint ES_SYSTEM_REQUIRED = 0x00000001;
  public const uint ES_DISPLAY_REQUIRED = 0x00000002;
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@

function Enable-KeepAwake {
  [void][NativeSleep]::SetThreadExecutionState(
    [NativeSleep]::ES_CONTINUOUS -bor
    [NativeSleep]::ES_SYSTEM_REQUIRED -bor
    [NativeSleep]::ES_DISPLAY_REQUIRED
  )
}

function Disable-KeepAwake {
  [void][NativeSleep]::SetThreadExecutionState([NativeSleep]::ES_CONTINUOUS)
}

function Invoke-JarvisCheck {
  param([string]$Url)
  try {
    $health = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 15
    $system = Invoke-RestMethod -Uri "$Url/api/cron/system" -TimeoutSec 15
    $schedule = $system.schedule
    $jobCount = @($system.jobs).Count
    $auto = $null
    try {
      $cfg = Invoke-RestMethod -Uri "$Url/api/approval/config" -TimeoutSec 15
      $auto = $cfg.autoApproveAll
    } catch {}
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host ("[{0}] health ok={1} db={2} cron={3} jobs={4} autoApproveAll={5}" -f `
      $stamp, $health.ok, $health.db, $schedule, $jobCount, $auto)
    return $true
  } catch {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Warning ("[{0}] check failed: {1}" -f $stamp, $_.Exception.Message)
    return $false
  }
}

Write-Host "Open Jarvis keep-awake — interval ${IntervalSeconds}s — API $BaseUrl"
Write-Host "Press Ctrl+C to stop (releases sleep block)."

Enable-KeepAwake

if ($SetPowerPlan) {
  try {
    powercfg /change standby-timeout-ac 0 | Out-Null
    powercfg /change monitor-timeout-ac 0 | Out-Null
    powercfg /change standby-timeout-dc 0 | Out-Null
    powercfg /change monitor-timeout-dc 0 | Out-Null
    Write-Host "Power plan: standby/monitor timeouts set to 0 (AC+DC)."
  } catch {
    Write-Warning "Could not change powercfg (try elevated PowerShell): $($_.Exception.Message)"
  }
}

try {
  while ($true) {
    Enable-KeepAwake
    if (-not $NoApiPing) {
      [void](Invoke-JarvisCheck -Url $BaseUrl)
    } else {
      Write-Host ("[{0}] keep-awake heartbeat" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
    }
    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  Disable-KeepAwake
  Write-Host "Keep-awake released."
}
