@echo off
cd /d "%~dp0"
start "OEE Backend" cmd /c node server/local-server.cjs
timeout /t 3 /nobreak >nul
start "OEE Frontend" cmd /c npx vite dev --port 5177 --strictPort
echo.
echo  OEE App started!
echo  Frontend: http://localhost:5177
echo  Backend:  http://localhost:5907
echo.
echo  Close both windows to stop.
pause
