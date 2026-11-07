@echo off
chcp 65001 >nul
title Unicode chaxun - stats
cd /d "%~dp0"

set "BASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=C:\Program Files (x86)\Git\bin\bash.exe"
if not exist "%BASH%" (
  echo [ERROR] Git Bash not found. Install Git for Windows first.
  pause
  exit /b 1
)

"%BASH%" tools/stats.sh

echo.
echo ============================================================
echo  Data refreshes live. Press any key to close.
echo ============================================================
pause >nul
