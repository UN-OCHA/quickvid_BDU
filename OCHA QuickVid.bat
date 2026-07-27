@echo off
setlocal EnableExtensions
REM ============================================================================
REM  OCHA QuickVid - Windows launcher (double-click me).
REM
REM  DELIBERATELY TINY - do not add logic here.
REM
REM  A running .bat cannot overwrite itself, so the self-update mirror EXCLUDES
REM  this one file. Everything it excludes can never be fixed remotely: on
REM  2026-07-27 a stray parenthesis in the old fat starter broke every launch
REM  after the first, and no update could repair it - every install had to be
REM  redone by hand. So all the real work now lives in tools\qv-engine.bat,
REM  which the mirror DOES reach. Keep this file boring and it stays correct.
REM ============================================================================
REM Shortcuts and the web-downloaded starter pass --detach instead of setting
REM QV_DETACH themselves: a .lnk that has to set an environment variable needs
REM "cmd /c set X=1 & ...", whose nested quotes are mangled differently by cmd,
REM PowerShell and the shell API. A plain flag has no quoting to get wrong.
if /i "%~1"=="--detach" set "QV_DETACH=1"

cd /d "%~dp0"
REM Apply a STAGED engine update. qv-engine.bat can't replace itself while it is
REM the running script either, so the updater in it drops the new copy alongside
REM as qv-engine.new.bat; we swap it in here, before anything is running. This
REM is the whole reason the launcher isn't a one-liner.
if exist "tools\qv-engine.new.bat" move /y "tools\qv-engine.new.bat" "tools\qv-engine.bat" >nul 2>&1
if not exist "tools\qv-engine.bat" (
  echo This OCHA QuickVid install is incomplete ^(tools\qv-engine.bat is missing^).
  echo Re-run the installer from https://un-ocha.github.io/quickvid_BDU/
  pause
  exit /b 1
)
call "tools\qv-engine.bat" %*
exit /b %errorlevel%
