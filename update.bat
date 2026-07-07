@echo off
REM ============================================================
REM UPDATE SEKALI KLIK - E-Tiket ApotekKU (Windows)
REM Cara pakai: double-click file ini.
REM ============================================================
cd /d "%~dp0"
git add -A
git commit -m "update: %date% %time%"
git push
echo.
echo Selesai! Tunggu 1 menit lalu buka situs dengan Ctrl+Shift+R.
pause
