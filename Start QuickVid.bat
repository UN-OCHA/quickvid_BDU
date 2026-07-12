@echo off
setlocal EnableExtensions
REM ============================================================================
REM  OCHA QuickVid - Windows start script (double-click me).
REM
REM  First run: sets everything up by itself - Python environment, a portable
REM  video engine (ffmpeg) and the speech-recognition model. No admin rights
REM  needed. One-time, ~10 minutes on office wifi. After that: starts in
REM  seconds and opens QuickVid in your browser.
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

echo OCHA QuickVid - checking your setup...

REM 1) Python 3.9-3.13 (user-space install, no admin needed)
set "PY="
call :trypy py -3.12
if not defined PY call :trypy py -3.11
if not defined PY call :trypy py -3.10
if not defined PY call :trypy py -3
if not defined PY call :trypy python
if not defined PY (
  echo.
  echo Python is missing. Opening the download page - install it for
  echo "just me" and TICK "Add python.exe to PATH", then double-click
  echo this file again.
  start "" "https://www.python.org/downloads/"
  pause
  exit /b 1
)

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
  if errorlevel 1 echo (couldn't pre-download - QuickVid will fetch it on first use instead)
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
REM    its one canonical address so saved progress is never split.
echo.
echo Starting OCHA QuickVid at http://127.0.0.1:%PORT%   (leave this window open)
start "" "http://127.0.0.1:%PORT%"
"%VPY%" -m uvicorn app.backend.main:app --host 127.0.0.1 --port %PORT%
pause
exit /b 0

:trypy
%* -c "import sys; sys.exit(0 if (3,9)<=sys.version_info[:2]<=(3,13) else 1)" >nul 2>&1
if not errorlevel 1 set "PY=%*"
goto :eof
