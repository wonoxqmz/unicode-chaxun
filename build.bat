@echo off
rem ============================================================
rem  Unicode Chaxun - rebuild helper
rem    build.bat            build desktop exe  (onefile, dist\Unicode编码查询.exe)
rem    build.bat exe        same as above
rem    build.bat apk        build android apk  (android\UnicodeChaxun-v*.apk)
rem    build.bat all        exe + apk
rem    build.bat clean      clean rebuild
rem
rem  Everything here is ASCII on purpose: cmd.exe reads .bat bytes
rem  as GBK on a Chinese Windows, so UTF-8 Chinese text would be
rem  garbled. Chinese file naming is handled inside the Python /
rem  shell scripts instead.
rem ============================================================
setlocal
cd /d "%~dp0"

set PY=C:\Users\LCJ\.workbuddy\binaries\python\envs\default\Scripts\python.exe
if not exist "%PY%" set PY=python

if "%~1"=="" goto exe
if /i "%~1"=="exe" goto exe
if /i "%~1"=="apk" goto apk
if /i "%~1"=="all" goto all
if /i "%~1"=="clean" goto exe
echo Unknown target: %~1   (use exe / apk / all / clean)
goto end

:exe
echo Using python: %PY%
"%PY%" desktop\pack.py %*
goto end

:apk
set BASH=%ProgramFiles%\Git\bin\bash.exe
if not exist "%BASH%" set BASH=%ProgramFiles(x86)%\Git\bin\bash.exe
if not exist "%BASH%" set BASH=C:\Program Files\Git\bin\bash.exe
if not exist "%BASH%" (
  echo Git Bash not found, cannot run android\build.sh
  goto end
)
"%BASH%" android\build.sh
goto end

:all
call :exe
if errorlevel 1 goto end
call :apk
goto end

:end
echo.
pause
