@echo off
title Lamplight
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Lamplight needs Node.js, which is free.
  echo   1. Get it from https://nodejs.org  ^(the big green LTS button^)
  echo   2. Install it, then double-click this file again.
  echo.
  pause
  exit /b
)
echo.
echo   Starting Lamplight and opening your browser...
echo   Keep this window open while you use it. Close it to stop watching.
echo.
node "%~dp0lamplight.cjs" live
echo.
echo   Lamplight has stopped.
pause
