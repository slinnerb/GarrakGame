@echo off
rem Garak :: Game - developer launcher (a Wrench and Ram project)
rem
rem THIS FILE IS FOR DEVELOPERS WITH Node.js + npm INSTALLED.
rem
rem If you are a player or a teacher trying to play the game, you have
rem the wrong file. Download the ready-to-run release ZIP from:
rem
rem   https://github.com/slinnerb/GarrakGame/releases/latest
rem
rem Extract it, then double-click "Garak Game.exe" inside.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ============================================================
  echo  This is the developer launcher.  Node.js is not installed.
  echo.
  echo  To play, download the release ZIP from:
  echo    https://github.com/slinnerb/GarrakGame/releases/latest
  echo  Extract it, then double-click "Garak Game.exe".
  echo  ============================================================
  echo.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies (one-time)...
  call npm install
)
echo Launching Garak :: Game...
start "" "node_modules\.bin\electron.cmd" .
