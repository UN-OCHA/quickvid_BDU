@echo off
setlocal EnableExtensions
REM ============================================================================
REM  OCHA QuickVid - STARTER for Windows (downloaded from the QuickVid page).
REM
REM  Double-click me to start the QuickVid engine. It stays on (a minimized
REM  window in your taskbar) until you shut down the PC - the QuickVid page
REM  unlocks by itself a few seconds later.
REM
REM  First run of a downloaded file: "More info" -> "Run anyway" (SmartScreen).
REM  Tip: keep me in Downloads or on the Desktop - I work every time.
REM ============================================================================
set "DEST=%LocalAppData%\OCHA QuickVid"
set "APP="
if exist "%DEST%\home.txt" set /p APP=<"%DEST%\home.txt"
if not exist "%APP%\Start QuickVid.bat" set "APP=%DEST%\app"

if not exist "%APP%\Start QuickVid.bat" (
  echo QuickVid isn't installed on this PC yet.
  echo Go back to the QuickVid page and download the INSTALLER ^(first-time^) instead.
  pause
  exit /b 1
)

set "QV_DETACH=1"
call "%APP%\Start QuickVid.bat"
exit /b %errorlevel%
