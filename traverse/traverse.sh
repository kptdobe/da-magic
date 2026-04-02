#!/bin/bash

# Wrapper script for traverse.js - S3 Key Sharding Traversal
# Usage: ./traverse.sh [--hex] <prefix> [output-file]

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_usage() {
    echo "Usage: $0 [--hex] <prefix> [output-file]"
    echo ""
    echo "Arguments:"
    echo "  prefix       Path prefix to traverse (required)"
    echo "  output-file  CSV output file (default: files.csv)"
    echo ""
    echo "Options:"
    echo "  --hex                Use 256 two-char hex shards (00-ff). Auto-enabled for .da-versions."
    echo "  --hex-extra=<chars>  Like --hex plus explicit shards for given first chars."
    echo "                       E.g. --hex-extra=.,_,-,@ adds one focused S3 query per char."
    echo ""
    echo "Description:"
    echo "  Efficiently traverses S3 bucket using key sharding and concurrent pagination."
    echo "  Outputs CSV with: FilePath, ContentLength, LastModified"
    echo ""
    echo "Examples:"
    echo "  $0 kptdobe/daplayground files.csv"
    echo "  $0 adobecom/.da-versions/ versions.csv        # auto uses --hex"
    echo "  $0 --hex org/.da-versions/ output.csv"
}

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if [[ $# -lt 1 ]]; then
    print_error "Insufficient arguments"
    show_usage
    exit 1
fi

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

# Parse --hex / --hex-extra flag
HEX_FLAG=""
if [[ "$1" == --hex-extra=* ]]; then
    HEX_FLAG="$1"
    shift
elif [[ "$1" == "--hex" ]]; then
    HEX_FLAG="--hex"
    shift
fi

PREFIX="$1"
OUTPUT_FILE="${2:-files.csv}"


if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install it first:"
    echo "  macOS: brew install node"
    exit 1
fi

NODE_SCRIPT="$SCRIPT_DIR/traverse.js"
if [[ ! -f "$NODE_SCRIPT" ]]; then
    print_error "traverse.js not found at: $NODE_SCRIPT"
    exit 1
fi

if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
    print_error "node_modules not found. Please run: cd traverse && npm install"
    exit 1
fi

cd "$SCRIPT_DIR"
node traverse.js $HEX_FLAG "$PREFIX" "$OUTPUT_FILE"

