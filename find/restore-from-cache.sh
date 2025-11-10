#!/bin/bash

# Script to restore files from .cache back to S3 with their original metadata
# Useful if something goes wrong during replacement
# Usage: ./restore-from-cache.sh <file-list>

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
    echo "  -b, --bucket <bucket>  S3 bucket name (default: aem-content)"
    echo "  --use-backup           Restore from .backup files instead of current cache"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Arguments:"
    echo "  file-list              Text file containing S3 object keys (one per line)"
    echo ""
    echo "Description:"
    echo "  Restores files from .cache directory back to S3 with their original metadata."
    echo "  Useful for rollback if something goes wrong during replacement."
    echo ""
    echo "Examples:"
    echo "  $0 list.txt                    # Restore modified files"
    echo "  $0 --use-backup list.txt       # Restore original backup files"
    echo "  $0 -b my-bucket files.txt"
    echo ""
    echo "Environment variables (from .dev.vars):"
    echo "  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_DEF_URL"
}

# Default values
BUCKET="aem-content"
FILE_LIST=""
USE_BACKUP=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -b|--bucket)
            BUCKET="$2"
            shift 2
            ;;
        --use-backup)
            USE_BACKUP=true
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

# Check cache directory
CACHE_DIR="$SCRIPT_DIR/.cache"
if [[ ! -d "$CACHE_DIR" ]]; then
    print_error "Cache directory not found: $CACHE_DIR"
    exit 1
fi

print_status "Cache directory: $CACHE_DIR"

# Count total files
TOTAL_FILES=$(wc -l < "$FILE_LIST" | tr -d ' ')
print_status "Restoring $TOTAL_FILES files from cache to S3"
print_status "Bucket: $BUCKET"

if [[ "$USE_BACKUP" = true ]]; then
    print_warning "Using BACKUP files (original, unmodified files)"
else
    print_status "Using current cache files (modified files)"
fi

echo ""

# Confirmation
read -p "Are you sure you want to restore these files to S3? (yes/no): " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
    print_warning "Restore cancelled"
    exit 0
fi

echo ""

# Statistics
PROCESSED=0
RESTORED=0
ERRORS=0

# Process each file
while IFS= read -r OBJECT_KEY || [[ -n "$OBJECT_KEY" ]]; do
    # Skip empty lines
    [[ -z "$OBJECT_KEY" ]] && continue
    
    PROCESSED=$((PROCESSED + 1))
    
    print_status "[$PROCESSED/$TOTAL_FILES] Restoring: $OBJECT_KEY"
    
    # Determine which file to restore
    CACHE_FILE="$CACHE_DIR/$OBJECT_KEY"
    CACHE_METADATA_FILE="$CACHE_FILE.metadata.json"
    
    if [[ "$USE_BACKUP" = true ]]; then
        RESTORE_FILE="$CACHE_FILE.backup"
        if [[ ! -f "$RESTORE_FILE" ]]; then
            print_error "  Backup file not found: $RESTORE_FILE"
            ERRORS=$((ERRORS + 1))
            continue
        fi
    else
        RESTORE_FILE="$CACHE_FILE"
        if [[ ! -f "$RESTORE_FILE" ]]; then
            print_error "  Cache file not found: $RESTORE_FILE"
            ERRORS=$((ERRORS + 1))
            continue
        fi
    fi
    
    # Check if metadata exists
    if [[ ! -f "$CACHE_METADATA_FILE" ]]; then
        print_error "  Metadata file not found: $CACHE_METADATA_FILE"
        ERRORS=$((ERRORS + 1))
        continue
    fi
    
    print_status "  Loading metadata from cache..."
    METADATA_JSON=$(cat "$CACHE_METADATA_FILE")
    
    # Extract Content-Type
    CONTENT_TYPE=$(echo "$METADATA_JSON" | grep -o '"ContentType": *"[^"]*"' | sed 's/"ContentType": *"//' | sed 's/"$//')
    if [[ -z "$CONTENT_TYPE" ]]; then
        CONTENT_TYPE="application/octet-stream"
    fi
    print_status "  Content-Type: $CONTENT_TYPE"
    
    # Extract custom metadata
    METADATA_OUTPUT=""
    METADATA_SECTION=$(echo "$METADATA_JSON" | grep -A 20 '"Metadata"' | grep -v '"Metadata":' | grep -v '^[[:space:]]*[{}]')
    
    if [[ -n "$METADATA_SECTION" ]]; then
        while IFS= read -r line; do
            if [[ $line =~ ^[[:space:]]*\"([^\"]+)\":[[:space:]]*(.+)$ ]]; then
                key="${BASH_REMATCH[1]}"
                value="${BASH_REMATCH[2]}"
                
                # Clean up the value
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
            print_status "  Restoring custom metadata"
        fi
    fi
    
    # Upload file back to S3
    print_status "  Uploading to S3..."
    
    if [[ -n "$METADATA_OUTPUT" ]]; then
        # Upload with metadata
        if aws s3api put-object \
            --bucket "$BUCKET" \
            --key "$OBJECT_KEY" \
            --body "$RESTORE_FILE" \
            --content-type "$CONTENT_TYPE" \
            --metadata "$METADATA_OUTPUT" \
            --endpoint-url "$ENDPOINT_URL" \
            --region auto \
            --no-cli-pager > /dev/null 2>&1; then
            print_success "  Successfully restored $OBJECT_KEY"
            RESTORED=$((RESTORED + 1))
        else
            print_error "  Failed to upload $OBJECT_KEY"
            ERRORS=$((ERRORS + 1))
        fi
    else
        # Upload without custom metadata
        if aws s3api put-object \
            --bucket "$BUCKET" \
            --key "$OBJECT_KEY" \
            --body "$RESTORE_FILE" \
            --content-type "$CONTENT_TYPE" \
            --endpoint-url "$ENDPOINT_URL" \
            --region auto \
            --no-cli-pager > /dev/null 2>&1; then
            print_success "  Successfully restored $OBJECT_KEY"
            RESTORED=$((RESTORED + 1))
        else
            print_error "  Failed to upload $OBJECT_KEY"
            ERRORS=$((ERRORS + 1))
        fi
    fi
    
    echo ""
    
done < "$FILE_LIST"

# Print summary
echo ""
echo "========================================================================"
echo "SUMMARY"
echo "========================================================================"
print_status "Total files processed: $PROCESSED"
print_success "Successfully restored: $RESTORED"
if [[ $ERRORS -gt 0 ]]; then
    print_error "Errors: $ERRORS"
else
    print_success "Errors: 0"
fi
echo ""

if [[ $ERRORS -eq 0 ]]; then
    print_success "All files restored successfully!"
    exit 0
else
    print_error "Some files failed to restore"
    exit 1
fi

