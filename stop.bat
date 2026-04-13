@echo off
title Smart AAC - Stopping
color 0C

echo.
echo  Stopping Smart AAC Dashboard...
echo.

taskkill /F /IM python.exe >nul 2>&1 && echo  [OK] Backend stopped || echo  [--] Backend was not running
taskkill /F /IM node.exe >nul 2>&1 && echo  [OK] Frontend stopped || echo  [--] Frontend was not running

echo.
echo  All servers stopped.
echo.
timeout /t 3 /nobreak >nul
