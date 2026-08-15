@echo off
setlocal
REM Windows 배치 래퍼 — PowerShell 스크립트 실행
REM 사용법:
REM   scripts\generate-pem.bat
REM   scripts\generate-pem.bat -Domain example.com
REM   scripts\generate-pem.bat -Serve

set "SCRIPT=%~dp0generate-pem.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
exit /b %ERRORLEVEL%
