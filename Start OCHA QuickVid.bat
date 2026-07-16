@echo off
setlocal EnableExtensions
REM ============================================================================
REM  OCHA QuickVid - Windows start script (double-click me).
REM
REM  First run: sets everything up by itself - Python itself (if you don't have
REM  it), the Python environment, a portable video engine (ffmpeg) and the
REM  speech-recognition model. No admin rights needed. One-time, ~10 minutes on
REM  office wifi. After that: starts in seconds and opens OCHA QuickVid in your browser.
REM
REM  Your videos never leave this machine.
REM
REM  Windows may show "Windows protected your PC" the FIRST time (SmartScreen,
REM  normal for files from the internet): click "More info" -> "Run anyway".
REM  You only do that once.
REM ============================================================================
cd /d "%~dp0"
set "PORT=17870"
if defined QV_PORT set "PORT=%QV_PORT%"

REM Self-register this install's location so the tiny "Start OCHA QuickVid" starter
REM the web page hands out can find the engine wherever it lives.
set "QV_SUPPORT=%LocalAppData%\OCHA QuickVid"
if not exist "%QV_SUPPORT%" mkdir "%QV_SUPPORT%"
echo %CD%> "%QV_SUPPORT%\home.txt"

REM Already running? Nothing to do - just open the page.
curl -s -m 2 "http://127.0.0.1:%PORT%/api/health" 2>nul | findstr /c:"quickvid" >nul
if not errorlevel 1 (
  echo OCHA QuickVid is already running - opening it in your browser.
  if not defined QV_NO_OPEN start "" "http://127.0.0.1:%PORT%"
  exit /b 0
)

REM --- Self-update: if GitHub has a newer version, refresh the app code before starting,
REM     so nobody re-downloads anything. Skipped for developer checkouts (.git) and when
REM     QV_NO_UPDATE is set; never blocks startup - any failure falls through to the
REM     current version.
if defined QV_NO_UPDATE goto :afterupdate
if exist ".git" goto :afterupdate
set "LOCAL_V=0.0.0"
if exist "VERSION" for /f "usebackq delims=" %%v in ("VERSION") do set "LOCAL_V=%%v"
set "REMOTE_V="
curl -fsL -m 3 "https://raw.githubusercontent.com/UN-OCHA/quickvid_BDU/main/VERSION" -o "%TEMP%\qv_remote_ver.txt" 2>nul
if exist "%TEMP%\qv_remote_ver.txt" for /f "usebackq delims=" %%v in ("%TEMP%\qv_remote_ver.txt") do set "REMOTE_V=%%v"
del "%TEMP%\qv_remote_ver.txt" >nul 2>&1
echo(%REMOTE_V%| findstr /r "^[0-9][0-9]*\.[0-9]" >nul 2>&1 || goto :afterupdate
if "%REMOTE_V%"=="%LOCAL_V%" goto :afterupdate
echo Updating OCHA QuickVid  %LOCAL_V% -^> %REMOTE_V% ...
set "UTMP=%TEMP%\qv_update_%RANDOM%"
mkdir "%UTMP%" 2>nul
curl -fsL -m 180 -o "%UTMP%\qv.zip" "https://github.com/UN-OCHA/quickvid_BDU/archive/refs/heads/main.zip"
if not exist "%UTMP%\qv.zip" ( echo ^(couldn't download the update - starting your current version^) & rd /s /q "%UTMP%" 2>nul & goto :afterupdate )
tar -xf "%UTMP%\qv.zip" -C "%UTMP%" 2>nul
if not exist "%UTMP%\quickvid_BDU-main\VERSION" ( echo ^(couldn't unpack the update - starting your current version^) & rd /s /q "%UTMP%" 2>nul & goto :afterupdate )
REM Mirror the new code over this install; keep .venv and this running .bat (a file can't
REM replace itself mid-run). /MIR clears anything dropped upstream; /IS re-copies even
REM same-size/time files so VERSION can't be stranded (which would re-update every launch).
robocopy "%UTMP%\quickvid_BDU-main" "%CD%" /MIR /IS /XD ".venv" ".git" /XF "Start OCHA QuickVid.bat" /NFL /NDL /NJH /NJS /NC /NS /NP >nul
copy /y "%UTMP%\quickvid_BDU-main\VERSION" "%CD%\VERSION" >nul 2>&1
echo Updated to %REMOTE_V%.
rd /s /q "%UTMP%" 2>nul
:afterupdate

echo OCHA QuickVid - checking your setup...

REM 1) Python 3.9-3.13. Find one; if none, install it JUST FOR THIS USER
REM    (no admin, no Store) from the official python.org installer.
set "PY="
call :trypy py -3.13
if not defined PY call :trypy py -3.12
if not defined PY call :trypy py -3.11
if not defined PY call :trypy py -3.10
if not defined PY call :trypy py -3
if not defined PY call :trypy python

if not defined PY (
  echo.
  echo Python isn't installed yet - setting it up for you now. No admin password needed.
  echo Downloading Python from python.org ^(~25 MB^)...
  curl -fL -o "%TEMP%\quickvid-python.exe" "https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe"
  if exist "%TEMP%\quickvid-python.exe" (
    echo Installing Python ^(a minute or two - a small window may appear^)...
    "%TEMP%\quickvid-python.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0
    del "%TEMP%\quickvid-python.exe" >nul 2>&1
  )
)
REM Freshly-installed Python isn't on THIS window's PATH yet - add its default
REM user location for this session so we can use it right away (no second run).
if not defined PY if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
  set "PATH=%LocalAppData%\Programs\Python\Python312;%LocalAppData%\Programs\Python\Python312\Scripts;%PATH%"
  call :trypy python
)

if not defined PY (
  echo.
  echo Couldn't set Python up automatically ^(your network may be blocking it^).
  echo Please install it by hand - about 2 minutes:
  echo     1. The download page is opening now.
  echo     2. Near the TOP of the page, click "Latest Python install manager".
  echo     3. Run it. If it asks, TICK "Add python.exe to PATH".
  echo     4. Double-click "Start OCHA QuickVid.bat" again.
  start "" "https://www.python.org/downloads/windows/"
  pause
  exit /b 1
)
echo Python is ready.

REM 2) Python environment + dependencies (one-time; quick when already done)
if not exist ".venv\Scripts\python.exe" (
  echo Setting up ^(one-time^) - creating the Python environment...
  %PY% -m venv .venv
  if errorlevel 1 ( echo Could not create the environment. & pause & exit /b 1 )
)
set "VPY=.venv\Scripts\python.exe"
"%VPY%" -m pip install -q --upgrade pip >nul 2>&1
"%VPY%" -m pip install -q -r requirements.txt
if errorlevel 1 ( echo Package install failed - check your internet connection. & pause & exit /b 1 )

REM 3) Video engine (ffmpeg). Uses one already on this PC if present; otherwise
REM    fetches a portable build into the app's own environment (no admin).
where ffmpeg >nul 2>&1
if errorlevel 1 if not exist ".venv\Scripts\ffmpeg.exe" (
  echo One-time: downloading the portable video engine ^(~80 MB, no admin needed^)...
  "%VPY%" -c "from static_ffmpeg import run; run.get_or_fetch_platform_executables_else_raise(); print('Video engine ready.')"
  if errorlevel 1 echo (couldn't pre-download - OCHA QuickVid will fetch it on first use instead)
)

REM 4) Speech-recognition model (one-time, ~500 MB) so the first transcription
REM    starts instantly instead of stalling mysteriously.
if not exist "%USERPROFILE%\.cache\huggingface\hub\models--Systran--faster-whisper-small" (
  echo One-time: downloading the speech-recognition model ^(~500 MB^).
  echo This is the longest step - a few minutes on office wifi. Progress below...
  "%VPY%" -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8'); print('Speech model ready.')"
  if errorlevel 1 echo (couldn't pre-download - the first transcription will fetch it instead)
)

REM 5) Launch and open the browser. 127.0.0.1 on purpose - the app treats it as
REM    its one canonical address so saved progress is never split. With
REM    QV_DETACH=1 (the web-downloaded starter/installer) the engine runs as a
REM    MINIMIZED window in the taskbar - this window can close; it stays on
REM    until the PC shuts down.
echo.
if defined QV_DETACH (
  start "OCHA QuickVid engine" /min cmd /c ""%VPY%" -m uvicorn app.backend.main:app --host 127.0.0.1 --port %PORT% >> "%QV_SUPPORT%\engine.log" 2>&1"

  REM Don't declare success on a blind wait - POLL for the real thing (mirrors
  REM the "already running" check above). A cold start can take longer than a
  REM fixed 2s, and a fixed wait can't tell "still starting" from "crashed" -
  REM it used to open the browser to a dead port either way and call it done.
  echo Starting the engine...
  set "UP="
  for /l %%n in (1,1,20) do (
    if not defined UP (
      curl -s -m 1 "http://127.0.0.1:%PORT%/api/health" 2>nul | findstr /c:"quickvid" >nul
      if not errorlevel 1 set "UP=1"
      if not defined UP timeout /t 1 /nobreak >nul
    )
  )

  if defined UP (
    if not defined QV_NO_OPEN start "" "http://127.0.0.1:%PORT%"
    echo OCHA QuickVid is running - you can CLOSE this window.
    echo It stays on as a minimized "OCHA QuickVid engine" window in your taskbar
    echo until you shut down the PC.
    timeout /t 5 >nul
    exit /b 0
  )

  echo.
  echo The engine didn't start. Here's what it said (full log: %QV_SUPPORT%\engine.log):
  echo ----------------------------------------------------------------------
  powershell -NoProfile -Command "if (Test-Path '%QV_SUPPORT%\engine.log') { Get-Content -Path '%QV_SUPPORT%\engine.log' -Tail 25 }"
  echo ----------------------------------------------------------------------
  echo Copy the lines above and send them to ochavisual@un.org - we'll sort it out.
  pause
  exit /b 1
)
echo Starting OCHA QuickVid at http://127.0.0.1:%PORT%   (leave this window open)
start "" "http://127.0.0.1:%PORT%"
"%VPY%" -m uvicorn app.backend.main:app --host 127.0.0.1 --port %PORT%
pause
exit /b 0

:trypy
%* -c "import sys; sys.exit(0 if (3,9)<=sys.version_info[:2]<=(3,13) else 1)" >nul 2>&1
if not errorlevel 1 set "PY=%*"
goto :eof
