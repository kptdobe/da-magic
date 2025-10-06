#!/bin/bash

# Batch fix encoding for all files in list.txt
# This script processes each file path in list.txt and runs fix-s3-document-encoding.sh

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LIST_FILE="$SCRIPT_DIR/list.txt"
FIX_SCRIPT="$SCRIPT_DIR/fix-s3-document-encoding.sh"

if [[ ! -f "$LIST_FILE" ]]; then
    echo "Error: list.txt not found"
    exit 1
fi

if [[ ! -f "$FIX_SCRIPT" ]]; then
    echo "Error: fix-s3-document-encoding.sh not found"
    exit 1
fi

echo "Starting batch encoding fix..."
echo "Processing $(wc -l < "$LIST_FILE") files"
echo ""

total=0
success=0
skipped=0
failed=0

while IFS= read -r line; do
    if [[ -z "$line" ]]; then
        continue
    fi
    
    total=$((total + 1))
    file_path="${line}.html"
    
    echo "[$total] Processing: $file_path"
    
    # Run the fix script and capture output
    if output=$(bash "$FIX_SCRIPT" "$file_path" 2>&1); then
        if echo "$output" | grep -q "No action needed"; then
            echo "    ✓ Skipped (not gzip-encoded)"
            skipped=$((skipped + 1))
        elif echo "$output" | grep -q "Content-Encoding successfully removed"; then
            echo "    ✓ Fixed successfully"
            success=$((success + 1))
        else
            echo "    ? Unknown result"
        fi
    else
        echo "    ✗ Failed"
        failed=$((failed + 1))
        # Show error details
        echo "$output" | grep -E "(ERROR|Error)" | head -3
    fi
    
    echo ""
done < "$LIST_FILE"

echo "========================================="
echo "Batch processing complete!"
echo "Total files: $total"
echo "Fixed: $success"
echo "Skipped (not gzip): $skipped"
echo "Failed: $failed"
echo "========================================="
