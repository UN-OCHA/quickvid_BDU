@echo off
setlocal EnableExtensions
REM ============================================================================
REM  OCHA QuickVid - one-time INSTALLER for Windows (downloaded from the page).
REM
REM  Double-click me. If Windows shows "Windows protected your PC" (SmartScreen,
REM  normal for internet downloads): click "More info" -> "Run anyway".
REM
REM  What I do, all by myself, no admin rights:
REM    1. Download OCHA QuickVid into a system folder you never need to touch
REM       (%LocalAppData%\OCHA QuickVid).
REM    2. Set everything up (Python if missing, video engine, speech model)
REM       - ~10 minutes the first time.
REM    3. Start the engine and open OCHA QuickVid in your browser.
REM
REM  Running me again later = UPDATE OCHA QuickVid (your setup is kept, so it's quick).
REM  Drag me onto a Command Prompt and add  --fresh  to also rebuild the Python
REM  environment from scratch (~10 min) when an install is misbehaving.
REM ============================================================================
set "DEST=%LocalAppData%\OCHA QuickVid"
set "APP=%DEST%\app"
set "PORT=17870"
set "ZIP_URL=https://github.com/UN-OCHA/quickvid_BDU/archive/refs/heads/main.zip"

set "FRESH=0"
if /i "%~1"=="--fresh" set "FRESH=1"

echo OCHA QuickVid - installing to a system folder ^(you never need to open it^).

REM ---------------------------------------------------------------------------
REM  Stop a running engine BEFORE touching any file. Two reasons, both of which
REM  bit real installs: (1) the engine keeps serving the OLD code from memory, so
REM  an "update" appears to work while the app still reports the previous version;
REM  (2) on Windows a live python.exe LOCKS files under %APP%, so rmdir silently
REM  half-fails and leaves a mix of old and new - which is how one PC ended up
REM  running 0.5.3 with 0.6.0 on disk.
REM ---------------------------------------------------------------------------
call :stopengine

if not exist "%DEST%" mkdir "%DEST%"

echo Downloading OCHA QuickVid ^(~1 MB^)...
set "TMPD=%TEMP%\quickvid_install_%RANDOM%"
mkdir "%TMPD%"
curl -fL -o "%TMPD%\quickvid.zip" "%ZIP_URL%"
if errorlevel 1 ( echo Download failed - check your internet connection. & pause & exit /b 1 )
tar -xf "%TMPD%\quickvid.zip" -C "%TMPD%"
if errorlevel 1 ( echo Could not unpack the download. & pause & exit /b 1 )
REM Never wipe anything on the strength of a download we haven't checked.
if not exist "%TMPD%\quickvid_BDU-main\VERSION" (
  echo The download looks incomplete - nothing was changed. Try again, or email ochavisual@un.org.
  rmdir /s /q "%TMPD%" >nul 2>&1
  pause & exit /b 1
)

REM Keep the existing Python setup across updates - makes re-installs fast.
REM --fresh deliberately drops it so the next launch rebuilds it.
if exist "%APP%\.venv" (
  if "%FRESH%"=="1" (
    echo Fresh install - rebuilding the Python environment from scratch ^(~10 min^).
  ) else (
    echo Updating ^(keeping your existing setup^)...
    move "%APP%\.venv" "%TMPD%\quickvid_BDU-main\.venv" >nul
    REM If the move only half-succeeded (a locked file), throw the remains away
    REM rather than carry a broken environment into the new install - the next
    REM launch rebuilds it, which is slow but always works.
    if errorlevel 1 (
      echo ^(couldn't carry your setup over - it will be rebuilt^)
      rmdir /s /q "%TMPD%\quickvid_BDU-main\.venv" >nul 2>&1
    )
  )
)

REM Delete the old app folder, then CHECK it actually went. A leftover folder here
REM means something still holds a lock - carrying on would produce the mixed
REM old/new install described above, so stop with an instruction the user can act on.
if exist "%APP%" rmdir /s /q "%APP%" >nul 2>&1
if exist "%APP%" (
  call :stopengine
  rmdir /s /q "%APP%" >nul 2>&1
)
if exist "%APP%" (
  echo.
  echo Could not replace the old version - a program is still using its files.
  echo Please restart Windows and run this installer again. Questions: ochavisual@un.org
  rmdir /s /q "%TMPD%" >nul 2>&1
  pause & exit /b 1
)

move "%TMPD%\quickvid_BDU-main" "%APP%" >nul
if errorlevel 1 ( echo Could not put the new version in place. & pause & exit /b 1 )
rmdir /s /q "%TMPD%" >nul 2>&1
echo %APP%> "%DEST%\home.txt"

echo.
echo Setting up and starting OCHA QuickVid...
set "QV_DETACH=1"
call "%APP%\Start OCHA QuickVid.bat"
exit /b %errorlevel%

REM ---------------------------------------------------------------------------
:stopengine
REM Kill whatever is listening on the engine port, then wait for it to let go of
REM its file handles. Mirrors the same subroutine in "Start OCHA QuickVid.bat".
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  echo Stopping the running OCHA QuickVid engine...
  taskkill /f /pid %%p >nul 2>&1
)
ping -n 3 127.0.0.1 >nul 2>&1
goto :eof
