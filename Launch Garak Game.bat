@echo off
rem Garak :: Game - quick launcher (Wrench and Ram)
rem Double-click to start the desktop app. Uses the local Electron binary
rem so it works without a global npm/electron install. Requires `npm install`
rem to have been run once.
cd /d "%~dp0"
if not exist "node_modules\electron" (
  echo Electron isn't installed yet. Running npm install...
  call npm install
)
echo Launching Garak :: Game...
start "" "node_modules\.bin\electron.cmd" .
