# Run this script in PowerShell **as Administrator**, then reboot.
# Enables WSL2 (required by Docker Desktop on Windows) and verifies Docker.

$ErrorActionPreference = 'Stop'

Write-Host 'Enabling WSL + Virtual Machine Platform…'
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart

Write-Host 'Installing/upgrading WSL…'
winget install Microsoft.WSL --accept-package-agreements --accept-source-agreements

Write-Host ''
Write-Host 'Done. REBOOT, then start Docker Desktop from the Start menu.'
Write-Host 'After Docker shows "running", from the project root:'
Write-Host '  bun run db:up'
Write-Host '  bun run verify:phase2'
