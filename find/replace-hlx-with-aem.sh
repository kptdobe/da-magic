#!/bin/bash

# Script to replace .hlx.page and .hlx.live with .aem.page and .aem.live in S3 files
# Downloads files, modifies them, and uploads back while preserving all metadata
# Usage: ./replace-hlx-with-aem.sh <file-list>

set -e  # Exit on any error

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
    echo "Usage: $0 [OPTIONS] <file-list>"
    echo ""
    echo "Options:"
    echo "  -b, --bucket <bucket>    S3 bucket name (default: aem-content)"
    echo "  --batch-size <size>      Number of files to process in parallel (default: 20)"
    echo "  -h, --help               Show this help message"
    echo ""
    echo "Arguments:"
    echo "  file-list                Text file containing S3 object keys (one per line)"
    echo ""
    echo "Description:"
    echo "  Downloads each file from S3, replaces .hlx.page with .aem.page and"
    echo "  .hlx.live with .aem.live, then uploads back preserving all metadata."
    echo "  Processes files in parallel batches for better performance."
    echo ""
    echo "Examples:"
    echo "  $0 list.txt"
    echo "  $0 files-bacom.txt"
    echo "  $0 -b my-bucket --batch-size 30 custom-list.txt"
    echo ""
    echo "Environment variables (from .dev.vars):"
    echo "  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_DEF_URL"
}

# Default values
BUCKET="aem-content"
FILE_LIST=""
BATCH_SIZE=20

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -b|--bucket)
            BUCKET="$2"
            shift 2
            ;;
        --batch-size)
            BATCH_SIZE="$2"
            shift 2
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
            if [[ -z "$FILE_LIST" ]]; then
                FILE_LIST="$1"
            else
                print_error "Too many arguments"
                show_usage
                exit 1
            fi
            shift
            ;;
    esac
done

# Check if required arguments are provided
if [[ -z "$FILE_LIST" ]]; then
    print_error "Missing required argument: file-list"
    show_usage
    exit 1
fi

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Convert to absolute path if relative
if [[ ! "$FILE_LIST" = /* ]]; then
    FILE_LIST="$SCRIPT_DIR/$FILE_LIST"
fi

# Check if file list exists
if [[ ! -f "$FILE_LIST" ]]; then
    print_error "File list not found: $FILE_LIST"
    exit 1
fi

# Load environment variables from .dev.vars
DEV_VARS_PATHS=(
    "$SCRIPT_DIR/../.dev.vars"
    "$SCRIPT_DIR/.dev.vars"
    ".dev.vars"
)

DEV_VARS_FOUND=false
for dev_vars_path in "${DEV_VARS_PATHS[@]}"; do
    if [[ -f "$dev_vars_path" ]]; then
        print_status "Loading environment variables from $dev_vars_path"
        export $(grep -v '^#' "$dev_vars_path" | xargs)
        DEV_VARS_FOUND=true
        break
    fi
done

if [[ "$DEV_VARS_FOUND" = false ]]; then
    print_error ".dev.vars file not found"
    exit 1
fi

# Check if required environment variables are set
if [[ -z "$S3_ACCESS_KEY_ID" ]] || [[ -z "$S3_SECRET_ACCESS_KEY" ]] || [[ -z "$S3_DEF_URL" ]]; then
    print_error "Missing required environment variables: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, or S3_DEF_URL"
    exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    print_status "Installation guide: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
fi

# Configure AWS CLI with environment variables
export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"
ENDPOINT_URL="$S3_DEF_URL"

# Create cache directory
CACHE_DIR="$SCRIPT_DIR/.cache"
mkdir -p "$CACHE_DIR"
print_status "Cache directory: $CACHE_DIR"

# Read all files into array
print_status "Loading file list..."
files=()
line_count=0
while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    files+=("$line")
    line_count=$((line_count + 1))
    # Show progress every 10000 lines
    if (( line_count % 10000 == 0 )); then
        echo -ne "\r${BLUE}[INFO]${NC} Loaded $line_count files..."
    fi
done < "$FILE_LIST"
echo -ne "\r"  # Clear the progress line

TOTAL_FILES=${#files[@]}
print_status "Processing $TOTAL_FILES files from $FILE_LIST"
print_status "Bucket: $BUCKET"
print_status "Batch size: $BATCH_SIZE (parallel processing)"
echo ""

# Function to process a single file
process_file() {
    local OBJECT_KEY="$1"
    local FILE_NUM="$2"
    local RESULT_FILE="$3"
    
    # Redirect all output to result file
    {
        # Create cache file path (preserve directory structure)
        CACHE_FILE="$CACHE_DIR/$OBJECT_KEY"
        CACHE_FILE_DIR=$(dirname "$CACHE_FILE")
        CACHE_METADATA_FILE="$CACHE_FILE.metadata.json"
        mkdir -p "$CACHE_FILE_DIR"
        
        # Download file from S3 (only if not already cached)
        if [[ ! -f "$CACHE_FILE" ]]; then
            if ! aws s3api get-object \
                --bucket "$BUCKET" \
                --key "$OBJECT_KEY" \
                "$CACHE_FILE" \
                --endpoint-url "$ENDPOINT_URL" \
                --region auto \
                --no-cli-pager > /dev/null 2>&1; then
                echo "ERROR:Failed to download"
                return 1
            fi
        fi
        
        # Check if file contains .hlx.page or .hlx.live
        if ! grep -q -E '\.hlx\.(page|live)' "$CACHE_FILE" 2>/dev/null; then
            echo "SKIPPED:No HLX references found"
            return 0
        fi
        
        # Create backup of original
        BACKUP_FILE="$CACHE_FILE.backup"
        if [[ ! -f "$BACKUP_FILE" ]]; then
            cp "$CACHE_FILE" "$BACKUP_FILE"
        fi
        
        # Perform replacements
        sed -i.tmp 's/\.hlx\.page/.aem.page/g; s/\.hlx\.live/.aem.live/g' "$CACHE_FILE"
        rm -f "$CACHE_FILE.tmp"
        
        # Verify changes were made
        if cmp -s "$CACHE_FILE" "$BACKUP_FILE"; then
            echo "SKIPPED:No changes made"
            return 0
        fi
        
        # Get metadata from cache or S3
        if [[ -f "$CACHE_METADATA_FILE" ]]; then
            METADATA_JSON=$(cat "$CACHE_METADATA_FILE")
        else
            METADATA_JSON=$(aws s3api head-object \
                --bucket "$BUCKET" \
                --key "$OBJECT_KEY" \
                --endpoint-url "$ENDPOINT_URL" \
                --region auto \
                --output json \
                --no-cli-pager 2>/dev/null)
            
            if [[ $? -ne 0 ]]; then
                echo "ERROR:Failed to retrieve metadata"
                return 1
            fi
            
            # Save metadata to cache
            echo "$METADATA_JSON" > "$CACHE_METADATA_FILE"
        fi
        
        # Extract Content-Type
        CONTENT_TYPE=$(echo "$METADATA_JSON" | grep -o '"ContentType": *"[^"]*"' | sed 's/"ContentType": *"//' | sed 's/"$//')
        if [[ -z "$CONTENT_TYPE" ]]; then
            CONTENT_TYPE="application/octet-stream"
        fi
        
        # Extract custom metadata
        METADATA_OUTPUT=""
        METADATA_SECTION=$(echo "$METADATA_JSON" | grep -A 20 '"Metadata"' | grep -v '"Metadata":' | grep -v '^[[:space:]]*[{}]')
        
        if [[ -n "$METADATA_SECTION" ]]; then
            while IFS= read -r line; do
                if [[ $line =~ ^[[:space:]]*\"([^\"]+)\":[[:space:]]*(.+)$ ]]; then
                    key="${BASH_REMATCH[1]}"
                    value="${BASH_REMATCH[2]}"
                    value=$(echo "$value" | sed 's/,$//' | sed 's/^"//' | sed 's/"$//')
                    
                    if [[ -n "$key" ]] && [[ -n "$value" ]]; then
                        if [[ -n "$METADATA_OUTPUT" ]]; then
                            METADATA_OUTPUT="$METADATA_OUTPUT,\"$key\":\"$value\""
                        else
                            METADATA_OUTPUT="\"$key\":\"$value\""
                        fi
                    fi
                fi
            done < <(echo "$METADATA_SECTION")
            
            if [[ -n "$METADATA_OUTPUT" ]]; then
                METADATA_OUTPUT="{$METADATA_OUTPUT}"
            fi
        fi
        
        # Upload modified file back to S3
        if [[ -n "$METADATA_OUTPUT" ]]; then
            if aws s3api put-object \
                --bucket "$BUCKET" \
                --key "$OBJECT_KEY" \
                --body "$CACHE_FILE" \
                --content-type "$CONTENT_TYPE" \
                --metadata "$METADATA_OUTPUT" \
                --endpoint-url "$ENDPOINT_URL" \
                --region auto \
                --no-cli-pager > /dev/null 2>&1; then
                echo "SUCCESS:Updated with metadata"
                return 0
            else
                echo "ERROR:Failed to upload"
                return 1
            fi
        else
            if aws s3api put-object \
                --bucket "$BUCKET" \
                --key "$OBJECT_KEY" \
                --body "$CACHE_FILE" \
                --content-type "$CONTENT_TYPE" \
                --endpoint-url "$ENDPOINT_URL" \
                --region auto \
                --no-cli-pager > /dev/null 2>&1; then
                echo "SUCCESS:Updated without metadata"
                return 0
            else
                echo "ERROR:Failed to upload"
                return 1
            fi
        fi
        
    } > "$RESULT_FILE" 2>&1
}

# Export function and variables for subshells
export -f process_file
export BUCKET
export ENDPOINT_URL
export CACHE_DIR
export SCRIPT_DIR
export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION

# Statistics
success=0
skipped=0
failed=0

# Process files in batches
for ((i=0; i<TOTAL_FILES; i+=BATCH_SIZE)); do
    batch_num=$((i/BATCH_SIZE + 1))
    batch_end=$((i + BATCH_SIZE))
    if [[ $batch_end -gt $TOTAL_FILES ]]; then
        batch_end=$TOTAL_FILES
    fi
    
    echo "========================================="
    echo "Batch $batch_num: Processing files $((i+1))-$batch_end of $TOTAL_FILES"
    echo "========================================="
    
    # Start processes for this batch
    pids=()
    for ((j=i; j<batch_end; j++)); do
        file_path="${files[$j]}"
        file_num=$((j + 1))
        result_file="/tmp/replace_result_${file_num}_$$"
        
        echo "[$file_num] Starting: $file_path"
        
        # Run process in background
        process_file "$file_path" "$file_num" "$result_file" &
        pids+=($!)
    done
    
    echo "Waiting for batch to complete..."
    echo ""
    
    # Wait for all processes
    for pid in "${pids[@]}"; do
        wait "$pid" 2>/dev/null || true
    done
    
    # Collect results
    for ((j=i; j<batch_end; j++)); do
        file_path="${files[$j]}"
        file_num=$((j + 1))
        result_file="/tmp/replace_result_${file_num}_$$"
        
        if [[ -f "$result_file" ]]; then
            result_content=$(cat "$result_file")
            
            if [[ "$result_content" == SKIPPED:* ]]; then
                reason="${result_content#SKIPPED:}"
                echo "[$file_num] ⊘ Skipped: $file_path ($reason)"
                skipped=$((skipped + 1))
            elif [[ "$result_content" == SUCCESS:* ]]; then
                echo "[$file_num] ✓ Updated: $file_path"
                success=$((success + 1))
            else
                reason="${result_content#ERROR:}"
                echo "[$file_num] ✗ Failed: $file_path ($reason)"
                failed=$((failed + 1))
            fi
            rm -f "$result_file"
        else
            echo "[$file_num] ✗ No result: $file_path"
            failed=$((failed + 1))
        fi
    done
    
    echo ""
    echo "Batch $batch_num completed."
    echo ""
done

# Print summary
echo ""
echo "========================================================================"
echo "SUMMARY"
echo "========================================================================"
print_status "Total files processed: $TOTAL_FILES"
print_success "Successfully modified: $success"
print_warning "Skipped (no changes): $skipped"
if [[ $failed -gt 0 ]]; then
    print_error "Errors: $failed"
else
    print_success "Errors: 0"
fi
echo ""
print_status "Cache directory: $CACHE_DIR"
print_status "Note: Cache files are preserved for future use"
echo ""

if [[ $failed -eq 0 ]]; then
    print_success "All files processed successfully!"
    exit 0
else
    print_error "Some files failed to process"
    exit 1
fi
