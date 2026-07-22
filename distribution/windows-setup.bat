@echo off
REM ============================================================
REM  OCHA QuickVid - one-time Windows setup
REM  Enables Adobe CEP "PlayerDebugMode" so the self-signed OCHA
REM  panel is allowed to load. Run once per computer. Safe to re-run.
REM ============================================================
echo Enabling PlayerDebugMode for Adobe CEP (Premiere Pro)...
for %%V in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
echo.
echo Done.
echo Next: install ocha-quickvid-panel.zxp with the ZXP/UXP Installer,
echo then open Premiere Pro ^> Window ^> Extensions ^> OCHA QuickVid.
echo.
pause
