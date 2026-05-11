#!/bin/bash

# Traverse S3 prefix for HTML and JSON, extract all href/src URLs into urls.tsv.
# Uses find-urls.js with traverse s3-utils (sharding, parallel listing) like traverse.sh.
# Usage: ./find-urls.sh <prefix> [output-file]

set -e

RED='\033[0;31m'
NC='\033[0m'

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_usage() {
    echo "Usage: $0 <prefix> [output-file]"
    echo ""
    echo "Arguments:"
    echo "  prefix       S3 prefix to traverse (required)"
    echo "  output-file  TSV output file (default: urls.tsv)"
    echo ""
    echo "Description:"
    echo "  Lists all .html, .htm, and .json objects under the S3 prefix,"
    echo "  extracts every href=\"...\" and src=\"...\" value, and writes"
    echo "  path<tab>url lines to the output file (progressively)."
    echo "  Ignores .da-versions and .trash."
    echo ""
    echo "Examples:"
    echo "  $0 /kptdobe"
    echo "  $0 cmegroup/www/drafts urls.tsv"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -lt 1 ]]; then
    print_error "Prefix required"
    show_usage
    exit 1
fi

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

PREFIX="$1"
OUTPUT_FILE="${2:-urls.tsv}"

if ! command -v node &>/dev/null; then
    print_error "Node.js is required. Install with: brew install node"
    exit 1
fi

NODE_SCRIPT="$SCRIPT_DIR/find-urls.js"
if [[ ! -f "$NODE_SCRIPT" ]]; then
    print_error "find-urls.js not found at: $NODE_SCRIPT"
    exit 1
fi

if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
    print_error "node_modules not found. Run: cd find && npm install"
    exit 1
fi

S3_UTILS="$SCRIPT_DIR/../traverse/s3-utils.js"
if [[ ! -f "$S3_UTILS" ]]; then
    print_error "traverse/s3-utils.js not found at: $S3_UTILS"
    exit 1
fi

cd "$SCRIPT_DIR"
node find-urls.js "$PREFIX" "$OUTPUT_FILE"
