@echo off
REM Double-click this on your Windows laptop to keep it awake
REM and check Open Jarvis every 2 minutes.
REM Leave the window open while the API / bun run dev is running.

cd /d "%~dp0\.."
title Open Jarvis - Windows laptop keep-awake
echo.
echo Starting Windows laptop keep-awake (2-minute checks)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0keep-awake.ps1" -IgnoreLidCloseOnAc %*

echo.
echo Keep-awake stopped.
pause
