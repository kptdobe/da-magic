#!/bin/bash

# Wrapper script for traverse.js - S3 Key Sharding Traversal
# Usage: ./traverse.sh <prefix> [output-file] [shard-count]

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
    echo "Usage: $0 <prefix> [output-file] [shard-count]"
    echo ""
    echo "Arguments:"
    echo "  prefix       Path prefix to traverse (required)"
    echo "  output-file  CSV output file (default: files.csv)"
    echo "  shard-count  Number of concurrent shards (default: 16, valid: 1-256)"
    echo ""
    echo "Description:"
    echo "  Efficiently traverses S3 bucket using key sharding and concurrent pagination."
    echo "  Uses prefix sharding to parallelize listing operations."
    echo "  Outputs CSV with: FilePath, ContentLength, LastModified"
    echo ""
    echo "Examples:"
    echo "  $0 /kptdobe"
    echo "  $0 kptdobe/daplayground files.csv"
    echo "  $0 /adobecom/da-bacom output.csv 32"
    echo "  $0 cmegroup/www cmegroup-files.csv 64"
    echo ""
    echo "Shard count guidelines:"
    echo "  - Small prefixes (<10K files): 1-8 shards"
    echo "  - Medium prefixes (10K-100K): 8-16 shards"
    echo "  - Large prefixes (100K-1M): 16-64 shards"
    echo "  - Huge prefixes (>1M files): 64-256 shards"
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
OUTPUT_FILE="${2:-files.csv}"
SHARD_COUNT="${3:-16}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install it first:"
    echo "  macOS: brew install node"
    echo "  Ubuntu/Debian: sudo apt-get install nodejs"
    echo "  CentOS/RHEL: sudo yum install nodejs"
    exit 1
fi

# Check if the Node.js script exists
NODE_SCRIPT="$SCRIPT_DIR/traverse.js"
if [[ ! -f "$NODE_SCRIPT" ]]; then
    print_error "traverse.js not found at: $NODE_SCRIPT"
    exit 1
fi

# Check if node_modules exists
if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
    print_error "node_modules not found. Please run: cd traverse && npm install"
    exit 1
fi

# Run the Node.js script
cd "$SCRIPT_DIR"
node traverse.js "$PREFIX" "$OUTPUT_FILE" "$SHARD_COUNT"

