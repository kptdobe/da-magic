#!/bin/bash

# S3 Document Admin - Startup Script
# Starts both backend and frontend servers

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Function to kill processes on specific ports
kill_port() {
    local port=$1
    local pids=$(lsof -ti:$port 2>/dev/null || true)
    if [ ! -z "$pids" ]; then
        print_warning "Killing existing processes on port $port"
        echo $pids | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

# Function to start backend
start_backend() {
    print_status "Starting backend server..."
    
    if check_port 9091; then
        print_warning "Port 9091 is already in use"
        kill_port 9091
    fi
    
    cd backend
    
    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        print_status "Installing backend dependencies..."
        npm install
    fi
    
    # Start backend in background
    npm start &
    BACKEND_PID=$!
    
    # Wait a moment for backend to start
    sleep 2
    
    # Check if backend started successfully
    if kill -0 $BACKEND_PID 2>/dev/null; then
        print_success "Backend started on port 9091 (PID: $BACKEND_PID)"
    else
        print_error "Failed to start backend"
        exit 1
    fi
    
    cd ..
}

# Function to start frontend
start_frontend() {
    print_status "Starting frontend server..."
    
    if check_port 9090; then
        print_warning "Port 9090 is already in use"
        kill_port 9090
    fi
    
    cd frontend
    
    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        print_status "Installing frontend dependencies..."
        npm install
    fi
    
    # Start frontend in background
    npm start &
    FRONTEND_PID=$!
    
    # Wait a moment for frontend to start
    sleep 3
    
    # Check if frontend started successfully
    if kill -0 $FRONTEND_PID 2>/dev/null; then
        print_success "Frontend started on port 9090 (PID: $FRONTEND_PID)"
    else
        print_error "Failed to start frontend"
        exit 1
    fi
    
    cd ..
}

# Function to cleanup on exit
cleanup() {
    print_status "Shutting down servers..."
    
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
        print_status "Backend stopped"
    fi
    
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
        print_status "Frontend stopped"
    fi
    
    # Kill any remaining processes on our ports
    kill_port 9090
    kill_port 9091
    
    print_success "Cleanup complete"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Main execution
main() {
    print_status "Starting S3 Document Admin Interface"
    echo ""
    
    # Check if we're in the right directory
    if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
        print_error "Please run this script from the admin directory"
        print_error "Expected structure: admin/start.sh, admin/backend/, admin/frontend/"
        exit 1
    fi
    
    # Check if .dev.vars exists
    if [ ! -f "../.dev.vars" ]; then
        print_error ".dev.vars file not found in project root"
        print_error "Please create .dev.vars with S3 credentials"
        exit 1
    fi
    
    # Start backend
    start_backend
    echo ""
    
    # Start frontend
    start_frontend
    echo ""
    
    print_success "Both servers are running!"
    echo ""
    print_status "Frontend: http://localhost:9090"
    print_status "Backend:  http://localhost:9091"
    print_status "Health:   http://localhost:9091/api/health"
    echo ""
    print_warning "Press Ctrl+C to stop both servers"
    echo ""
    
    # Wait for user to stop
    wait
}

# Run main function
main "$@"
