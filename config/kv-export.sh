#!/bin/bash

# Wrapper script for cloudflare-kv-export.js
# Usage: ./kv-export.sh [output-file]

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_usage() {
    echo "Usage: $0 <namespace-id> [output-file] [ignore-slashes]"
    echo ""
    echo "Arguments:"
    echo "  namespace-id    Cloudflare KV namespace ID (required)"
    echo "  output-file     JSON output file (default: kv-export.json)"
    echo "  ignore-slashes  Set to 'true' to exclude keys containing '/' (default: false)"
    echo ""
    echo "Description:"
    echo "  Exports all keys and values from a Cloudflare KV namespace."
    echo "  Requires CF_ACCOUNT_ID and CF_API_TOKEN in .dev.vars"
    echo ""
    echo "Examples:"
    echo "  $0 abc123def456"
    echo "  $0 abc123def456 my-export.json"
    echo "  $0 abc123def456 my-export.json true"
}

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

# Check for required namespace ID argument
if [[ $# -lt 1 ]]; then
    print_error "Namespace ID is required"
    show_usage
    exit 1
fi

NAMESPACE_ID="$1"
OUTPUT_FILE="${2:-kv-export.json}"
IGNORE_SLASHES="${3:-false}"

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed"
    exit 1
fi

# Check script exists
NODE_SCRIPT="$SCRIPT_DIR/cloudflare-kv-export.js"
if [[ ! -f "$NODE_SCRIPT" ]]; then
    print_error "cloudflare-kv-export.js not found"
    exit 1
fi

# Check node_modules
if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
    print_error "node_modules not found. Please run: cd config && npm install"
    exit 1
fi

# Run
cd "$SCRIPT_DIR"
node cloudflare-kv-export.js "$NAMESPACE_ID" "$OUTPUT_FILE" "$IGNORE_SLASHES"

