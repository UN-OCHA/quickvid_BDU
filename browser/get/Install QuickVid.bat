@echo off
setlocal EnableExtensions
REM ============================================================================
REM  OCHA QuickVid - one-time INSTALLER for Windows (downloaded from the page).
REM
REM  Double-click me. If Windows shows "Windows protected your PC" (SmartScreen,
REM  normal for internet downloads): click "More info" -> "Run anyway".
REM
REM  What I do, all by myself, no admin rights:
REM    1. Download QuickVid into a system folder you never need to touch
REM       (%LocalAppData%\OCHA QuickVid).
REM    2. Set everything up (Python if missing, video engine, speech model)
REM       - ~10 minutes the first time.
REM    3. Start the engine and open QuickVid in your browser.
REM
REM  Running me again later = UPDATE QuickVid (your setup is kept, so it's quick).
REM ============================================================================
set "DEST=%LocalAppData%\OCHA QuickVid"
set "APP=%DEST%\app"
set "ZIP_URL=https://github.com/UN-OCHA/quickvid_BDU/archive/refs/heads/main.zip"

echo OCHA QuickVid - installing to a system folder ^(you never need to open it^).
if not exist "%DEST%" mkdir "%DEST%"

echo Downloading QuickVid ^(~1 MB^)...
set "TMPD=%TEMP%\quickvid_install_%RANDOM%"
mkdir "%TMPD%"
curl -fL -o "%TMPD%\quickvid.zip" "%ZIP_URL%"
if errorlevel 1 ( echo Download failed - check your internet connection. & pause & exit /b 1 )
tar -xf "%TMPD%\quickvid.zip" -C "%TMPD%"
if errorlevel 1 ( echo Could not unpack the download. & pause & exit /b 1 )

REM Keep the existing Python setup across updates - makes re-installs fast.
if exist "%APP%\.venv" (
  echo Updating ^(keeping your existing setup^)...
  move "%APP%\.venv" "%TMPD%\quickvid_BDU-main\.venv" >nul
)
if exist "%APP%" rmdir /s /q "%APP%"
move "%TMPD%\quickvid_BDU-main" "%APP%" >nul
rmdir /s /q "%TMPD%" >nul 2>&1
echo %APP%> "%DEST%\home.txt"

echo.
echo Setting up and starting QuickVid...
set "QV_DETACH=1"
call "%APP%\Start QuickVid.bat"
exit /b %errorlevel%
