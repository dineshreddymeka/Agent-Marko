#Requires -Version 5.1
<#
.SYNOPSIS
  Keep your Windows laptop awake and check Open Jarvis every 2 minutes.

.DESCRIPTION
  For the Windows laptop that runs Open Jarvis (Agent-Marko / hermes-ui):
  - Blocks sleep + display-off with SetThreadExecutionState (while this window is open)
  - Sets AC + battery standby/monitor timeouts to Never (-SetPowerPlan, default on)
  - Optionally ignores lid-close sleep when plugged in (-IgnoreLidCloseOnAc)
  - Every 2 minutes: GET /api/health, /api/cron/system, /api/approval/config

  Leave this PowerShell window open while `bun run dev` (or the API) is running.
  Close the window or press Ctrl+C to allow normal sleep again.

.EXAMPLE
  # Double-click scripts\keep-awake-windows.cmd  OR:
  .\scripts\keep-awake.ps1

  .\scripts\keep-awake.ps1 -BaseUrl http://127.0.0.1:3001 -IgnoreLidCloseOnAc
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = $(if ($env:BETTER_AUTH_URL) { $env:BETTER_AUTH_URL } else { 'http://127.0.0.1:3001' }),
  [int]$IntervalSeconds = 120,
  [switch]$NoSetPowerPlan,
  [switch]$IgnoreLidCloseOnAc,
  [switch]$NoApiPing
)

$ErrorActionPreference = 'Continue'
$BaseUrl = $BaseUrl.TrimEnd('/')
if ($IntervalSeconds -lt 30) { $IntervalSeconds = 30 }

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

function Set-LaptopNoSleepPowerPlan {
  # Never sleep / turn off display on AC or battery while Open Jarvis is the daily driver.
  $cmds = @(
    'powercfg /change standby-timeout-ac 0',
    'powercfg /change monitor-timeout-ac 0',
    'powercfg /change hibernate-timeout-ac 0',
    'powercfg /change standby-timeout-dc 0',
    'powercfg /change monitor-timeout-dc 0',
    'powercfg /change hibernate-timeout-dc 0'
  )
  foreach ($c in $cmds) {
    cmd /c $c | Out-Null
  }
  Write-Host "Windows laptop power plan: sleep/hibernate/monitor = Never (AC + battery)."
}

function Set-IgnoreLidCloseOnAc {
  # 0 = Do nothing when lid closes (plugged in only). Needs admin for some SKUs.
  try {
    cmd /c 'powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_BUTTONS LIDACTION 0' | Out-Null
    cmd /c 'powercfg /SETACTIVE SCHEME_CURRENT' | Out-Null
    Write-Host "Lid close on AC: Do nothing (laptop can stay running closed while plugged in)."
  } catch {
    Write-Warning "Could not set lid action (try Run as Administrator): $($_.Exception.Message)"
  }
}

function Invoke-JarvisCheck {
  param([string]$Url)
  try {
    $health = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 15
    $system = Invoke-RestMethod -Uri "$Url/api/cron/system" -TimeoutSec 15
    $schedule = $system.schedule
    $jobCount = @($system.jobs).Count
    $kinds = @($system.catalog | ForEach-Object { $_.kind }) -join ','
    $auto = $null
    try {
      $cfg = Invoke-RestMethod -Uri "$Url/api/approval/config" -TimeoutSec 15
      $auto = $cfg.autoApproveAll
    } catch {}
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host ("[{0}] laptop-check ok={1} db={2} cron={3} jobs={4} kinds=[{5}] autoApproveAll={6}" -f `
      $stamp, $health.ok, $health.db, $schedule, $jobCount, $kinds, $auto)
    return $true
  } catch {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Warning ("[{0}] API not reachable yet ({1}). Keep this window open; will retry." -f $stamp, $_.Exception.Message)
    return $false
  }
}

Write-Host ""
Write-Host "=== Open Jarvis — Windows laptop keep-awake ==="
Write-Host "Check every: ${IntervalSeconds}s (2 minutes default)"
Write-Host "API:         $BaseUrl"
Write-Host "Leave this window open. Ctrl+C stops keep-awake."
Write-Host ""

Enable-KeepAwake

if (-not $NoSetPowerPlan) {
  try {
    Set-LaptopNoSleepPowerPlan
  } catch {
    Write-Warning "powercfg failed (open PowerShell as Administrator once): $($_.Exception.Message)"
  }
}

if ($IgnoreLidCloseOnAc) {
  Set-IgnoreLidCloseOnAc
}

try {
  while ($true) {
    Enable-KeepAwake
    if (-not $NoApiPing) {
      [void](Invoke-JarvisCheck -Url $BaseUrl)
    } else {
      Write-Host ("[{0}] Windows laptop keep-awake heartbeat" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
    }
    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  Disable-KeepAwake
  Write-Host "Windows laptop keep-awake released — normal sleep rules apply again."
}
