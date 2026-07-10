@echo off
REM Double-click to run the bio updater. Leave this window open while you play.
cd /d "%~dp0bio-updater"
if not exist node_modules (
  echo Installing dependencies (first run only)...
  call npm install
)
echo Starting bio updater. Keep this window open while playing GD.
node index.js
pause
