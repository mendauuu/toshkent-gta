@echo off
rem Starts Grand Theft Avto: Toshkent
cd /d "%~dp0"
if exist "dist\ToshkentGTA-win32-x64\ToshkentGTA.exe" (
  start "" "dist\ToshkentGTA-win32-x64\ToshkentGTA.exe"
) else if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" .
) else (
  echo The game has not been built yet. See README.md.
  pause
)
