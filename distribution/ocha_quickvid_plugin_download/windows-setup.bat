@echo off
REM ============================================================
REM  OCHA QuickVid - Windows setup helper
REM
REM  What this does:
REM  Enables Adobe's "PlayerDebugMode" so Premiere Pro loads the
REM  panel on Windows. Without this, some Windows installs open
REM  the panel blank/gray or hide it from Window > Extensions.
REM
REM  How to use:
REM  Double-click this file. Click "Yes" if Windows asks. A small
REM  window appears, confirms with "Done.", and closes on a key press.
REM  Then close Premiere Pro (fully) and reopen it.
REM  You only need to run this once on this computer.
REM ============================================================

echo.
echo  Enabling Premiere Pro panel support...
echo.

REM Write the key under HKEY_CURRENT_USER for every CEP version Adobe
REM might use. No admin rights needed. Extra entries for versions Premiere
REM doesn't run are harmless - they just sit as orphan keys.
reg add "HKCU\Software\Adobe\CSXS.7"  /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.8"  /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.9"  /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.13" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.14" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.15" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.16" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1

echo  Done.
echo.
echo  Next step:
echo    1. Close Adobe Premiere Pro completely (File - Exit).
echo    2. Install ocha_quickvid_plugin.zxp with the ZXP/UXP Installer.
echo    3. Open Premiere Pro, then Window - Extensions - OCHA QuickVid.
echo.
echo  You only need to run this once on this computer.
echo.
pause
