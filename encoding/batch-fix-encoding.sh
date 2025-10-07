#!/bin/bash

# Simple batch fix encoding script
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LIST_FILE="$SCRIPT_DIR/list.txt"
FIX_SCRIPT="$SCRIPT_DIR/fix-s3-document-encoding.sh"
BATCH_SIZE=20

if [[ ! -f "$LIST_FILE" ]]; then
    echo "Error: list.txt not found"
    exit 1
fi

if [[ ! -f "$FIX_SCRIPT" ]]; then
    echo "Error: fix-s3-document-encoding.sh not found"
    exit 1
fi

echo "Starting batch encoding fix..."
echo "Processing $(wc -l < "$LIST_FILE") files in parallel batches of $BATCH_SIZE"
echo ""

total=0
success=0
skipped=0
failed=0

# Read file list
files=()
while IFS= read -r line; do
    if [[ -n "$line" ]]; then
        files+=("$line")
    fi
done < "$LIST_FILE"

total=${#files[@]}
echo "Total files to process: $total"
echo ""

# Process in batches
for ((i=0; i<total; i+=BATCH_SIZE)); do
    batch_num=$((i/BATCH_SIZE + 1))
    batch_end=$((i + BATCH_SIZE))
    if [[ $batch_end -gt $total ]]; then
        batch_end=$total
    fi
    
    echo "========================================="
    echo "Batch $batch_num: Processing files $((i+1))-$batch_end of $total"
    echo "========================================="
    
    # Start processes for this batch
    pids=()
    for ((j=i; j<batch_end; j++)); do
        file_path="${files[$j]}"
        file_num=$((j + 1))
        
        echo "Starting process for file $file_num: $file_path"
        
        # Run fix script in background
        bash "$FIX_SCRIPT" "$file_path" > "/tmp/fix_result_${file_num}_$$" 2>&1 &
        pids+=($!)
    done
    
    echo "Waiting for batch to complete..."
    
    # Wait for all processes
    for pid in "${pids[@]}"; do
        wait "$pid" 2>/dev/null || true
    done
    
    # Collect results
    for ((j=i; j<batch_end; j++)); do
        file_path="${files[$j]}"
        file_num=$((j + 1))
        result_file="/tmp/fix_result_${file_num}_$$"
        
        if [[ -f "$result_file" ]]; then
            if grep -q "No action needed" "$result_file"; then
                echo "[$file_num] ✓ Skipped: $file_path"
                skipped=$((skipped + 1))
            elif grep -q "Content-Encoding successfully removed" "$result_file"; then
                echo "[$file_num] ✓ Fixed: $file_path"
                success=$((success + 1))
            else
                echo "[$file_num] ✗ Failed: $file_path"
                failed=$((failed + 1))
            fi
            rm -f "$result_file"
        else
            echo "[$file_num] ✗ No result: $file_path"
            failed=$((failed + 1))
        fi
    done
    
    echo "Batch $batch_num completed."
    echo ""
done

echo "========================================="
echo "Batch processing complete!"
echo "Total files: $total"
echo "Fixed: $success"
echo "Skipped: $skipped"
echo "Failed: $failed"
echo "========================================="
