@echo off
title Lamplight
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Lamplight needs Node.js, which is free.
  echo   1. Get it from https://nodejs.org  ^^(the big green LTS button^^)
  echo   2. Install it, then double-click this file again.
  echo.
  pause
  exit /b
)
if not exist "%~dp0lamplight.cjs" (
  echo   First run: downloading the scanner...
  curl -L -o "%~dp0lamplight.cjs" https://raw.githubusercontent.com/Vishwanathanirv/home-network-guardian/main/scanner/lamplight.cjs
  if errorlevel 1 (
    echo   Could not download the scanner. Check your internet and run this again.
    pause
    exit /b
  )
)
echo   Starting Lamplight and opening your browser...
echo   Keep this window open while you use it. Close it to stop watching.
node "%~dp0lamplight.cjs" live
pause
