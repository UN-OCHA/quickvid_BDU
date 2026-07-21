@echo off
REM OCHA QuickVid panel - update helper (Windows).
REM
REM Launched detached via a .vbs by js/auto-updater.js (a .bat spawned directly
REM does not survive Premiere's exit, whatever detached/stdio options are used -
REM the DataViz plugin established that the hard way). Waits for Premiere to quit,
REM then extracts the staged package over the extension folder.
REM
REM   %1 staged package   %2 extension folder   %3 marker   %4 log   %5 version
setlocal EnableExtensions EnableDelayedExpansion
set "STAGED=%~1"
set "PLUGIN_DIR=%~2"
set "MARKER=%~3"
set "LOG=%~4"
set "VERSION=%~5"
if "%LOG%"=="" set "LOG=%TEMP%\ocha-quickvid-update.log"

call :log "==== OCHA QuickVid update helper started (v%VERSION%) ===="
if "%STAGED%"=="" call :abort "missing staged package argument"
if "%PLUGIN_DIR%"=="" call :abort "missing extension folder argument"
if not exist "%STAGED%" call :abort "staged package not found"
if not exist "%PLUGIN_DIR%" call :abort "extension folder not found"

REM Never extract over a folder that isn't ours - this runs unattended.
if not exist "%PLUGIN_DIR%\CSXS\manifest.xml" call :abort "not a CEP extension"
findstr /c:"org.unocha.branding" "%PLUGIN_DIR%\CSXS\manifest.xml" >nul 2>&1
if errorlevel 1 call :abort "not the OCHA QuickVid extension"

call :log "Waiting for Premiere to quit..."
set /a WAITED=0
:waitloop
tasklist /fi "imagename eq Adobe Premiere Pro.exe" 2>nul | find /i "Adobe Premiere Pro.exe" >nul
if errorlevel 1 goto gone
ping -n 2 127.0.0.1 >nul 2>&1
set /a WAITED+=1
if %WAITED% GEQ 1800 call :abort "timed out waiting for Premiere to quit"
goto waitloop
:gone
call :log "Premiere exited after ~%WAITED%s"
ping -n 3 127.0.0.1 >nul 2>&1

call :log "Extracting into %PLUGIN_DIR% ..."
REM PowerShell Expand-Archive is on every supported Windows; -Force overwrites.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { Expand-Archive -LiteralPath '%STAGED%' -DestinationPath '%PLUGIN_DIR%' -Force; exit 0 } catch { exit 1 }" >>"%LOG%" 2>&1
if errorlevel 1 call :abort "extraction failed (see %LOG%)"
call :log "Extraction complete."

del /f /q "%STAGED%" >nul 2>&1
del /f /q "%MARKER%" >nul 2>&1
for %%I in ("%MARKER%") do set "MARKER_DIR=%%~dpI"
>"%MARKER_DIR%__pendingUpdate.applied.json" echo {"version":"%VERSION%","appliedAt":"%DATE% %TIME%"}
call :log "==== finished cleanly ===="
exit /b 0

:log
echo [%DATE% %TIME%] %~1>>"%LOG%"
exit /b 0

:abort
call :log "ABORT: %~1"
for %%I in ("%MARKER%") do set "MARKER_DIR=%%~dpI"
if not "%MARKER_DIR%"=="" >"%MARKER_DIR%__pendingUpdate.error.json" echo {"error":"%~1"}
exit /b 1
