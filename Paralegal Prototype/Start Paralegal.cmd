@echo off
cd /d "%~dp0"
python paralegal_server.py --open
if errorlevel 1 (
  echo.
  echo Paralegal could not start. Read the message above.
  pause
)
