#!/bin/bash

# Extract unique file paths from hlx-references.txt
# Usage: ./extract-files.sh [input-file] [output-file]
# Default: ./extract-files.sh hlx-references.txt files.txt

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Parse arguments
INPUT_FILE="${1:-hlx-references.txt}"
OUTPUT_FILE="${2:-files.txt}"

# Convert to absolute path if relative
if [[ ! "$INPUT_FILE" = /* ]]; then
    INPUT_FILE="$SCRIPT_DIR/$INPUT_FILE"
fi

if [[ ! "$OUTPUT_FILE" = /* ]]; then
    OUTPUT_FILE="$SCRIPT_DIR/$OUTPUT_FILE"
fi

# Check if input file exists
if [[ ! -f "$INPUT_FILE" ]]; then
    print_error "Input file not found: $INPUT_FILE"
    exit 1
fi

print_info "Reading from: $INPUT_FILE"
print_info "Writing to: $OUTPUT_FILE"

# Extract first column (file paths), skip header, get unique entries, and sort
tail -n +2 "$INPUT_FILE" | cut -f1 | sort -u > "$OUTPUT_FILE"

# Count the results
TOTAL_COUNT=$(wc -l < "$OUTPUT_FILE" | tr -d ' ')

print_info "Extracted $TOTAL_COUNT unique file paths"
print_info "Output written to: $OUTPUT_FILE"

echo ""
echo "First 10 files:"
head -10 "$OUTPUT_FILE"

if [[ $TOTAL_COUNT -gt 10 ]]; then
    echo "..."
    echo "(showing 10 of $TOTAL_COUNT files)"
fi

