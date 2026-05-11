#!/bin/bash

# Batch-delete S3 folders listed in a file, running up to 10 in parallel.
# By default, dry-run mode: passes no -x flag to delete-s3-folder.sh.
# Use -x to actually delete.

PARALLEL=10
EXECUTE=false
INPUT_FILE="one-file-projects.txt"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
    case $1 in
        -x|--execute)
            EXECUTE=true
            shift
            ;;
        -p|--parallel)
            PARALLEL="$2"
            shift 2
            ;;
        -f|--file)
            INPUT_FILE="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [-x] [-p <parallelism>] [-f <input-file>]"
            echo ""
            echo "Options:"
            echo "  -x, --execute             Actually delete (default is dry-run)"
            echo "  -p, --parallel <n>        Number of parallel jobs (default: 10)"
            echo "  -f, --file <path>         Input file with folder paths (default: doe-app-svc-migrated.txt)"
            echo "  -h, --help                Show this help message"
            exit 0
            ;;
        *)
            echo "[ERROR] Unknown option: $1"
            exit 1
            ;;
    esac
done

if [[ ! -f "$INPUT_FILE" ]]; then
    echo "[ERROR] Input file not found: $INPUT_FILE"
    exit 1
fi

if [[ "$EXECUTE" == true ]]; then
    echo "Mode: EXECUTE — changes will be applied"
else
    echo "Mode: DRY RUN (pass -x to execute)"
fi

EXTRA_FLAGS=()
[[ "$EXECUTE" == true ]] && EXTRA_FLAGS+=("-x")

TOTAL_LINES=$(grep -c . "$INPUT_FILE")
echo "[INFO] Processing $TOTAL_LINES folder(s) from $INPUT_FILE with parallelism=$PARALLEL"
echo ""

PIDS=()
FOLDERS=()
COMPLETED=0
ERRORS=0

run_delete() {
    local folder="$1"
    local log
    log=$("$SCRIPT_DIR/delete-s3-folder.sh" "${EXTRA_FLAGS[@]}" "$folder" 2>&1)
    local status=$?
    # Print output as a block with the folder as header to reduce interleaving noise
    echo "=== $folder ==="
    echo "$log"
    echo ""
    return $status
}

export -f run_delete
export SCRIPT_DIR
export EXECUTE

# Use a job pool: launch up to PARALLEL background jobs, wait for one slot before launching the next
while IFS= read -r folder || [[ -n "$folder" ]]; do
    [[ -z "$folder" ]] && continue

    # Wait if we've hit the parallelism limit
    while [[ ${#PIDS[@]} -ge $PARALLEL ]]; do
        # Wait for any child to finish
        for i in "${!PIDS[@]}"; do
            if ! kill -0 "${PIDS[$i]}" 2>/dev/null; then
                wait "${PIDS[$i]}"
                status=$?
                [[ $status -ne 0 ]] && ERRORS=$((ERRORS + 1))
                COMPLETED=$((COMPLETED + 1))
                unset 'PIDS[$i]'
                unset 'FOLDERS[$i]'
                PIDS=("${PIDS[@]}")
                FOLDERS=("${FOLDERS[@]}")
                break
            fi
        done
        # Small sleep to avoid busy-wait
        sleep 0.1
    done

    run_delete "$folder" &
    PIDS+=($!)
    FOLDERS+=("$folder")

done < "$INPUT_FILE"

# Wait for remaining jobs
for i in "${!PIDS[@]}"; do
    wait "${PIDS[$i]}"
    status=$?
    [[ $status -ne 0 ]] && ERRORS=$((ERRORS + 1))
    COMPLETED=$((COMPLETED + 1))
done

echo "==============================="
echo "[INFO] Completed: $COMPLETED folder(s)"
[[ $ERRORS -gt 0 ]] && echo "[WARNING] $ERRORS folder(s) had errors" || echo "[SUCCESS] All folders processed without errors"

[[ $ERRORS -gt 0 ]] && exit 1 || exit 0
