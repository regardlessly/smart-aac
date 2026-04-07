@echo off
title Smart AAC - Starting...

:: Set paths
set PYTHON=C:\Users\Kimmy\AppData\Local\Programs\Python\Python312\python.exe
set NODE=C:\Program Files\nodejs\node.exe
set NPM=C:\Program Files\nodejs\npm.cmd
set PROJECT=C:\Users\Kimmy\Claude\smart-aac
set LOGDIR=%TEMP%

:: Set environment
set FLASK_ENV=development
set CAMERA_WORKER_ENABLED=true

echo ============================================================
echo  Smart AAC Dashboard
echo ============================================================
echo.

:: Start backend
echo Starting backend on port 5001...
start "Smart AAC Backend" /min cmd /c "cd /d %PROJECT%\backend && "%PYTHON%" run.py > "%LOGDIR%\smart-aac-backend.log" 2>&1"

:: Start frontend
echo Starting frontend on port 3000...
start "Smart AAC Frontend" /min cmd /c "cd /d %PROJECT%\frontend && "%NPM%" run dev > "%LOGDIR%\smart-aac-frontend.log" 2>&1"

:: Wait for servers
echo.
echo Waiting for servers to start...
timeout /t 8 /nobreak > nul

echo.
echo ============================================================
echo  Backend:  http://localhost:5001
echo  Frontend: http://localhost:3000
echo  Logs:     %LOGDIR%\smart-aac-*.log
echo ============================================================
echo.
echo Press any key to open the dashboard in your browser...
pause > nul
start http://localhost:3000
