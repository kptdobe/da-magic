#!/bin/bash

# Wrapper script for find-gzip-files.js
# Usage: ./find-gzip-files.sh <prefix>
# Example: ./find-gzip-files.sh cmegroup/www/drafts

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 <prefix>"
    echo ""
    echo "Arguments:"
    echo "  prefix  Path prefix to search in the S3 bucket (required)"
    echo ""
    echo "Description:"
    echo "  This script finds all files with gzip ContentEncoding in the S3 bucket."
    echo "  It scans recursively through all files under the specified prefix."
    echo ""
    echo "Examples:"
    echo "  $0 cmegroup/www/drafts"
    echo "  $0 cmegroup/www/drafts/kunwar"
    echo "  $0 cmegroup/www"
    echo ""
    echo "Output:"
    echo "  - Summary statistics"
    echo "  - Detailed list of gzip-encoded files"
    echo "  - Simple list for batch processing"
}

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check arguments
if [[ $# -lt 1 ]]; then
    print_error "Insufficient arguments"
    show_usage
    exit 1
fi

# Handle help flag
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

PREFIX="$1"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install it first:"
    echo "  macOS: brew install node"
    echo "  Ubuntu/Debian: sudo apt-get install nodejs"
    echo "  CentOS/RHEL: sudo yum install nodejs"
    exit 1
fi

# Check if the Node.js script exists
NODE_SCRIPT="$SCRIPT_DIR/find-gzip-files.js"
if [[ ! -f "$NODE_SCRIPT" ]]; then
    print_error "find-gzip-files.js not found at: $NODE_SCRIPT"
    exit 1
fi

# Check if node_modules exists
if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
    print_error "node_modules not found. Please run: npm install"
    exit 1
fi

# Run the Node.js script
cd "$SCRIPT_DIR"
node find-gzip-files.js "$PREFIX"
