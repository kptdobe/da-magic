@echo off
REM S3 Document Admin - Startup Script for Windows
REM Starts both backend and frontend servers

echo [INFO] Starting S3 Document Admin Interface
echo.

REM Check if we're in the right directory
if not exist "backend" (
    echo [ERROR] Please run this script from the admin directory
    echo [ERROR] Expected structure: admin/start.bat, admin/backend/, admin/frontend/
    pause
    exit /b 1
)

if not exist "frontend" (
    echo [ERROR] Please run this script from the admin directory
    echo [ERROR] Expected structure: admin/start.bat, admin/backend/, admin/frontend/
    pause
    exit /b 1
)

REM Check if .dev.vars exists
if not exist "..\.dev.vars" (
    echo [ERROR] .dev.vars file not found in project root
    echo [ERROR] Please create .dev.vars with S3 credentials
    pause
    exit /b 1
)

echo [INFO] Starting backend server...

REM Start backend
cd backend
if not exist "node_modules" (
    echo [INFO] Installing backend dependencies...
    call npm install
)

start "Backend Server" cmd /k "npm start"
cd ..

REM Wait a moment for backend to start
timeout /t 3 /nobreak >nul

echo [SUCCESS] Backend started on port 9091
echo.

echo [INFO] Starting frontend server...

REM Start frontend
cd frontend
if not exist "node_modules" (
    echo [INFO] Installing frontend dependencies...
    call npm install
)

start "Frontend Server" cmd /k "npm start"
cd ..

REM Wait a moment for frontend to start
timeout /t 3 /nobreak >nul

echo [SUCCESS] Frontend started on port 9090
echo.

echo [SUCCESS] Both servers are running!
echo.
echo [INFO] Frontend: http://localhost:9090
echo [INFO] Backend:  http://localhost:9091
echo [INFO] Health:   http://localhost:9091/api/health
echo.
echo [WARNING] Close the command windows to stop the servers
echo.

pause
