#!/bin/bash

# Script to copy all files from a source S3 folder to a destination S3 folder (non-recursive).
# Overwrites existing files in the destination. Uses environment variables from .dev.vars file.
# Default: dry run (simulate only). Use --execute to perform the copy.

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

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS] <source-folder-path> <destination-folder-path>"
    echo ""
    echo "Copies all files from the source folder to the destination folder (non-recursive)."
    echo "Existing files in the destination are overwritten."
    echo ""
    echo "Options:"
    echo "  -b, --bucket <bucket>     S3 bucket name (default: aem-content)"
    echo "  -o, --org <organization>  Organization prefix for folder paths"
    echo "  -x, --execute             Actually perform the copy (default is dry run)"
    echo "  -h, --help                Show this help message"
    echo ""
    echo "By default the script runs in dry-run mode (simulates only). Use -x/--execute to copy."
    echo ""
    echo "Examples:"
    echo "  $0 'images/' 'backup/images/'              # dry run: show what would be copied"
    echo "  $0 -x 'images/' 'backup/images/'          # execute: copy files"
    echo "  $0 -o 'myorg' --execute 'uploads/' 'archive/uploads/'"
    echo ""
    echo "Environment variables (from .dev.vars):"
    echo "  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_DEF_URL"
}

# Default values
BUCKET="aem-content"
ORG=""
SOURCE_PATH=""
DEST_PATH=""
DRY_RUN=true

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -b|--bucket)
            BUCKET="$2"
            shift 2
            ;;
        -o|--org)
            ORG="$2"
            shift 2
            ;;
        -x|--execute)
            DRY_RUN=false
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        -*)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
        *)
            if [[ -z "$SOURCE_PATH" ]]; then
                SOURCE_PATH="$1"
            elif [[ -z "$DEST_PATH" ]]; then
                DEST_PATH="$1"
            else
                print_error "Too many arguments"
                show_usage
                exit 1
            fi
            shift
            ;;
    esac
done

# Check required arguments
if [[ -z "$SOURCE_PATH" ]] || [[ -z "$DEST_PATH" ]]; then
    print_error "Missing required arguments: source folder path and destination folder path"
    show_usage
    exit 1
fi

# Normalize paths: treat "/" as root (empty)
[[ "$SOURCE_PATH" == "/" ]] && SOURCE_PATH=""
[[ "$DEST_PATH" == "/" ]] && DEST_PATH=""

# Load environment variables from .dev.vars
if [[ -f ".dev.vars" ]]; then
    print_status "Loading environment variables from .dev.vars"
    export $(grep -v '^#' .dev.vars | xargs)
else
    print_error ".dev.vars file not found"
    exit 1
fi

# Check required environment variables
if [[ -z "$S3_ACCESS_KEY_ID" ]] || [[ -z "$S3_SECRET_ACCESS_KEY" ]] || [[ -z "$S3_DEF_URL" ]]; then
    print_error "Missing required environment variables: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, or S3_DEF_URL"
    exit 1
fi

# Construct full paths with optional org prefix
FULL_SOURCE_PATH="$SOURCE_PATH"
FULL_DEST_PATH="$DEST_PATH"
if [[ -n "$ORG" ]]; then
    FULL_SOURCE_PATH="$ORG/$SOURCE_PATH"
    FULL_DEST_PATH="$ORG/$DEST_PATH"
fi

# Ensure folder paths end with /
[[ -n "$FULL_SOURCE_PATH" ]] && [[ ! "$FULL_SOURCE_PATH" =~ /$ ]] && FULL_SOURCE_PATH="$FULL_SOURCE_PATH/"
[[ -n "$FULL_DEST_PATH" ]] && [[ ! "$FULL_DEST_PATH" =~ /$ ]] && FULL_DEST_PATH="$FULL_DEST_PATH/"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check jq (required for pagination when folder has >1000 objects)
if ! command -v jq &> /dev/null; then
    print_error "jq is required for correct listing (S3 returns max 1000 per request). Please install jq."
    print_status "  macOS: brew install jq"
    exit 1
fi

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"
ENDPOINT_URL="$S3_DEF_URL"

# Paginate list-objects-v2 and output all keys (non-recursive: delimiter "/").
list_all_keys_paginated() {
    local prefix="$1"
    local token=""
    while true; do
        local args=(--bucket "$BUCKET" --prefix "$prefix" --delimiter "/" --endpoint-url "$ENDPOINT_URL" --region auto --output json --no-cli-pager)
        [[ -n "$token" ]] && args+=(--starting-token "$token")
        local resp
        resp=$(aws s3api list-objects-v2 "${args[@]}")
        echo "$resp" | jq -r '.Contents[]?.Key // empty'
        [[ "$(echo "$resp" | jq -r '.IsTruncated')" != "true" ]] && break
        token=$(echo "$resp" | jq -r '.NextContinuationToken')
    done
}

# List all direct files in source folder (paginated, non-recursive)
print_status "Listing files in source folder: $FULL_SOURCE_PATH"
SOURCE_KEYS=$(list_all_keys_paginated "$FULL_SOURCE_PATH")

if [[ -z "$SOURCE_KEYS" ]]; then
    print_warning "No files found in source folder: $FULL_SOURCE_PATH"
    exit 0
fi

FILE_COUNT=$(echo "$SOURCE_KEYS" | grep -c . || true)

COPIED_FILE="copied.txt"

if [[ "$DRY_RUN" == true ]]; then
    print_warning "DRY RUN (no changes will be made). Use -x or --execute to perform the copy."
    print_status "Found $FILE_COUNT file(s). Would copy to: $FULL_DEST_PATH"
    : > "$COPIED_FILE"
    echo ""
    while IFS= read -r KEY; do
        [[ -z "$KEY" ]] && continue
        FILENAME="${KEY#$FULL_SOURCE_PATH}"
        DEST_KEY="${FULL_DEST_PATH}${FILENAME}"
        print_status "  Would copy: $KEY -> $DEST_KEY"
        echo "$DEST_KEY" >> "$COPIED_FILE"
    done <<< "$SOURCE_KEYS"
    echo ""
    print_status "Summary: $FILE_COUNT file(s) would be copied. Run with --execute to perform."
    print_status "List of would-be copied keys saved to: $COPIED_FILE"
    exit 0
fi

: > "$COPIED_FILE"

PARALLEL_JOBS=10
TEMP_DIR=$(mktemp -d)
FAILED_FILE="$TEMP_DIR/failed.txt"
: > "$FAILED_FILE"
trap 'rm -rf "$TEMP_DIR"' EXIT

# Portable lock so only one job appends/writes at a time
lock() { while ! mkdir "$TEMP_DIR/lock" 2>/dev/null; do sleep 0.01; done; }
unlock() { rmdir "$TEMP_DIR/lock" 2>/dev/null; }

print_status "Found $FILE_COUNT file(s). Copying to: $FULL_DEST_PATH (up to $PARALLEL_JOBS in parallel)"
print_status "Copy log will be written to: $COPIED_FILE"
echo ""

job_id=0
keys_batch=()
while IFS= read -r KEY; do
    [[ -z "$KEY" ]] && continue
    keys_batch+=("$KEY")
    if [[ ${#keys_batch[@]} -eq $PARALLEL_JOBS ]]; then
        for KEY in "${keys_batch[@]}"; do
            FILENAME="${KEY#$FULL_SOURCE_PATH}"
            DEST_KEY="${FULL_DEST_PATH}${FILENAME}"
            (
                k="$KEY" d="$DEST_KEY"
                if aws s3api copy-object \
                    --bucket "$BUCKET" \
                    --copy-source "$BUCKET/$k" \
                    --key "$d" \
                    --endpoint-url "$ENDPOINT_URL" \
                    --region auto \
                    --no-cli-pager &>/dev/null; then
                    lock; echo "$d" >> "$COPIED_FILE"; unlock
                    print_success "Copied: $k -> $d"
                else
                    lock; echo "$k" >> "$FAILED_FILE"; unlock
                    print_error "Failed to copy: $k"
                fi
            ) &
            ((job_id++)) || true
        done
        wait
        keys_batch=()
    fi
done <<< "$SOURCE_KEYS"

# remaining batch
for KEY in "${keys_batch[@]}"; do
    FILENAME="${KEY#$FULL_SOURCE_PATH}"
    DEST_KEY="${FULL_DEST_PATH}${FILENAME}"
    (
        k="$KEY" d="$DEST_KEY"
        if aws s3api copy-object \
            --bucket "$BUCKET" \
            --copy-source "$BUCKET/$k" \
            --key "$d" \
            --endpoint-url "$ENDPOINT_URL" \
            --region auto \
            --no-cli-pager &>/dev/null; then
            lock; echo "$d" >> "$COPIED_FILE"; unlock
            print_success "Copied: $k -> $d"
        else
            lock; echo "$k" >> "$FAILED_FILE"; unlock
            print_error "Failed to copy: $k"
        fi
    ) &
    ((job_id++)) || true
done
wait

COPIED=$(($(wc -l < "$COPIED_FILE")))
FAILED=$(($(wc -l < "$FAILED_FILE")))

print_status ""
print_status "Summary: $COPIED copied, $FAILED failed (total: $FILE_COUNT)"
print_status "List of copied keys saved to: $COPIED_FILE"
if [[ $FAILED -gt 0 ]]; then
    exit 1
fi
print_success "Done."
