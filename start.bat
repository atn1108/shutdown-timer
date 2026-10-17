@echo off
title Shutdown Timer
cd /d "%~dp0"
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" .
) else (
  echo Chua cai Electron. Chay "npm install" truoc nhe.
  pause
)
