@echo off
title Smart AAC Dashboard
color 0A

:: Set paths
set PYTHON=C:\Users\Kimmy\AppData\Local\Programs\Python\Python312\python.exe
set NPM=C:\Program Files\nodejs\npm.cmd
set PROJECT=%~dp0
set LOGDIR=%TEMP%

:: Set environment
set FLASK_ENV=development
set CAMERA_WORKER_ENABLED=true

echo.
echo  ============================================================
echo   Smart AAC Dashboard - CaritaHub
echo  ============================================================
echo.

:: Kill any existing instances
echo  Stopping existing processes...
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:: Start backend
echo  Starting backend (port 5001)...
start "Smart AAC Backend" /min cmd /c "cd /d %PROJECT%backend && "%PYTHON%" run.py > "%LOGDIR%\smart-aac-backend.log" 2>&1"

:: Start frontend
echo  Starting frontend (port 3000)...
start "Smart AAC Frontend" /min cmd /c "cd /d %PROJECT%frontend && "%NPM%" run dev > "%LOGDIR%\smart-aac-frontend.log" 2>&1"

:: Wait and check
echo.
echo  Waiting for servers...
timeout /t 10 /nobreak >nul

:: Health check
curl -s -o nul -w "" http://localhost:5001/api/config/odoo >nul 2>&1
if %errorlevel%==0 (
    echo  [OK] Backend running on port 5001
) else (
    echo  [!!] Backend may not be ready yet
)

curl -s -o nul -w "" http://localhost:3000 >nul 2>&1
if %errorlevel%==0 (
    echo  [OK] Frontend running on port 3000
) else (
    echo  [!!] Frontend may not be ready yet
)

echo.
echo  ============================================================
echo   Backend:  http://localhost:5001
echo   Frontend: http://localhost:3000
echo   Logs:     %LOGDIR%\smart-aac-*.log
echo  ============================================================
echo.

:: Open browser
start http://localhost:3000

echo  Dashboard opened in browser.
echo  Close this window to keep servers running in background.
echo  Run stop.bat to stop all servers.
echo.
pause
