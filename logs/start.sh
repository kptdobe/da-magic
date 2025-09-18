#!/bin/bash

# Coralogix Logs Search App Startup Script

echo "🚀 Starting Coralogix Logs Search App..."

# Check if .dev.vars exists
if [ ! -f "../.dev.vars" ]; then
    echo "❌ Error: .dev.vars file not found in project root"
    echo "Please create .dev.vars with your Coralogix credentials"
    exit 1
fi

# Function to start backend
start_backend() {
    echo "📦 Installing backend dependencies..."
    cd backend
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    
    echo "🔧 Starting backend server on port 9093..."
    npm start &
    BACKEND_PID=$!
    cd ..
}

# Function to start frontend
start_frontend() {
    echo "📦 Installing frontend dependencies..."
    cd frontend
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    
    echo "🎨 Starting frontend server on port 9092..."
    PORT=9092 npm start &
    FRONTEND_PID=$!
    cd ..
}

# Start both servers
start_backend
sleep 3
start_frontend

echo ""
echo "✅ Coralogix Logs Search App is starting up!"
echo ""
echo "🎨 Frontend: http://localhost:9092"
echo "📊 Backend:  http://localhost:9093"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for user interrupt
trap 'echo ""; echo "🛑 Stopping servers..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0' INT

# Keep script running
wait
