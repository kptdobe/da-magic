#!/bin/bash

# Script to list all files in a given folder from S3 bucket
# Uses environment variables from .dev.vars file

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
    echo "Usage: $0 [OPTIONS] <folder-path>"
    echo ""
    echo "Options:"
    echo "  -b, --bucket <bucket>     S3 bucket name (default: aem-content)"
    echo "  -o, --org <organization>  Organization prefix for folder path"
    echo "  -r, --recursive          List files recursively (including subfolders)"
    echo "  -d, --details            Show detailed file information (size, last modified, content-type)"
    echo "  -f, --output-file <file> Output file to save the listing (one entry per line)"
    echo "  -h, --help               Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 '/' # List root folders"
    echo "  $0 '' # List root folders (empty string)"
    echo "  $0 'images/'"
    echo "  $0 -o 'myorg' 'documents/'"
    echo "  $0 -b 'my-bucket' -r 'uploads/'"
    echo "  $0 -d 'assets/'"
    echo "  $0 -f 'file_list.txt' 'images/'"
    echo ""
    echo "Environment variables (from .dev.vars):"
    echo "  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_DEF_URL"
}

# Default values
BUCKET="aem-content"
ORG=""
FOLDER_PATH=""
RECURSIVE=false
SHOW_DETAILS=false
OUTPUT_FILE=""

# Save original arg count to check if any arguments were provided
ORIGINAL_ARG_COUNT=$#

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
        -r|--recursive)
            RECURSIVE=true
            shift
            ;;
        -d|--details)
            SHOW_DETAILS=true
            shift
            ;;
        -f|--output-file)
            OUTPUT_FILE="$2"
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
            if [[ -z "$FOLDER_PATH" ]]; then
                FOLDER_PATH="$1"
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
# Allow empty path for root listing
if [[ $ORIGINAL_ARG_COUNT -eq 0 ]]; then
    print_error "Missing required argument: folder path (use '/' or '.' for root)"
    show_usage
    exit 1
fi

# Default to root if empty string provided or just "/"
if [[ -z "$FOLDER_PATH" ]] || [[ "$FOLDER_PATH" == "/" ]]; then
    FOLDER_PATH=""
fi

# Load environment variables from .dev.vars
if [[ -f ".dev.vars" ]]; then
    print_status "Loading environment variables from .dev.vars"
    export $(grep -v '^#' .dev.vars | xargs)
else
    print_error ".dev.vars file not found"
    exit 1
fi

# Check if required environment variables are set
if [[ -z "$S3_ACCESS_KEY_ID" ]] || [[ -z "$S3_SECRET_ACCESS_KEY" ]] || [[ -z "$S3_DEF_URL" ]]; then
    print_error "Missing required environment variables: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, or S3_DEF_URL"
    exit 1
fi

# Construct the full folder path
FULL_FOLDER_PATH="$FOLDER_PATH"
if [[ -n "$ORG" ]]; then
    FULL_FOLDER_PATH="$ORG/$FOLDER_PATH"
fi

# Ensure folder path ends with / for proper S3 listing (unless it's empty for root)
if [[ -n "$FULL_FOLDER_PATH" ]] && [[ ! "$FULL_FOLDER_PATH" =~ /$ ]]; then
    FULL_FOLDER_PATH="$FULL_FOLDER_PATH/"
fi

if [[ -z "$FULL_FOLDER_PATH" ]]; then
    print_status "Listing contents of: ROOT (bucket root)"
else
    print_status "Listing contents of folder: $FULL_FOLDER_PATH"
fi
print_status "Bucket: $BUCKET"
print_status "Recursive: $RECURSIVE"
print_status "Show details: $SHOW_DETAILS"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    print_status "Installation guide: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
fi

# Check if jq is installed (required for pagination when folder has >1000 objects)
if ! command -v jq &> /dev/null; then
    print_error "jq is required for correct listing and counts (S3 returns max 1000 per request). Please install jq."
    print_status "  macOS: brew install jq"
    print_status "  Ubuntu/Debian: sudo apt-get install jq"
    exit 1
fi

# Paginate list-objects-v2 and output all keys (optionally to file). Uses delimiter when set (non-recursive).
list_all_keys_paginated() {
    local prefix="$1"
    local delimiter="$2"
    local output_file="$3"
    local token=""
    while true; do
        local args=(--bucket "$BUCKET" --prefix "$prefix" --endpoint-url "$ENDPOINT_URL" --region auto --output json --no-cli-pager)
        [[ -n "$delimiter" ]] && args+=(--delimiter "$delimiter")
        [[ -n "$token" ]] && args+=(--starting-token "$token")
        local resp
        resp=$(aws s3api list-objects-v2 "${args[@]}")
        local keys
        keys=$(echo "$resp" | jq -r '.Contents[]?.Key // empty')
        echo "$keys"
        [[ -n "$output_file" ]] && [[ -n "$keys" ]] && echo "$keys" >> "$output_file"
        [[ "$(echo "$resp" | jq -r '.IsTruncated')" != "true" ]] && break
        token=$(echo "$resp" | jq -r '.NextContinuationToken')
    done
}

# Paginate and output all CommonPrefixes (subfolder names). Used for non-recursive listing.
list_all_common_prefixes_paginated() {
    local prefix="$1"
    local output_file="$2"
    local token=""
    while true; do
        local args=(--bucket "$BUCKET" --prefix "$prefix" --delimiter "/" --endpoint-url "$ENDPOINT_URL" --region auto --output json --no-cli-pager)
        [[ -n "$token" ]] && args+=(--starting-token "$token")
        local resp
        resp=$(aws s3api list-objects-v2 "${args[@]}")
        local prefixes
        prefixes=$(echo "$resp" | jq -r '.CommonPrefixes[]?.Prefix // empty')
        echo "$prefixes"
        [[ -n "$output_file" ]] && [[ -n "$prefixes" ]] && echo "$prefixes" >> "$output_file"
        [[ "$(echo "$resp" | jq -r '.IsTruncated')" != "true" ]] && break
        token=$(echo "$resp" | jq -r '.NextContinuationToken')
    done
}

# Count total objects (and optionally common prefixes) with pagination. Prints "total_objects [total_prefixes]".
count_paginated() {
    local prefix="$1"
    local use_delimiter="$2"
    local total_objects=0
    local total_prefixes=0
    local token=""
    while true; do
        local args=(--bucket "$BUCKET" --prefix "$prefix" --endpoint-url "$ENDPOINT_URL" --region auto --output json --no-cli-pager)
        [[ "$use_delimiter" == "true" ]] && args+=(--delimiter "/")
        [[ -n "$token" ]] && args+=(--starting-token "$token")
        local resp
        resp=$(aws s3api list-objects-v2 "${args[@]}")
        n=$(echo "$resp" | jq -r '(.Contents // []) | length' 2>/dev/null) || n=0
        total_objects=$((total_objects + ${n:-0}))
        if [[ "$use_delimiter" == "true" ]]; then
            p=$(echo "$resp" | jq -r '(.CommonPrefixes // []) | length' 2>/dev/null) || p=0
            total_prefixes=$((total_prefixes + ${p:-0}))
        fi
        [[ "$(echo "$resp" | jq -r '.IsTruncated')" != "true" ]] && break
        token=$(echo "$resp" | jq -r '.NextContinuationToken')
    done
    echo "$total_objects $total_prefixes"
}

# Configure AWS CLI with environment variables
export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"

# Extract endpoint URL from S3_DEF_URL (remove https:// prefix if present)
ENDPOINT_URL="$S3_DEF_URL"

# List objects in the folder
print_status "Executing AWS CLI command to list folder contents..."

if [[ "$RECURSIVE" == true ]]; then
    print_status "Listing files recursively (including subfolders)..."
    
    if [[ "$SHOW_DETAILS" == true ]]; then
        # List with detailed information recursively (paginated)
        if [[ -n "$OUTPUT_FILE" ]]; then
            print_status "Saving detailed listing to: $OUTPUT_FILE"
            : > "$OUTPUT_FILE"
        fi
        _first_page=true
        _token=""
        while true; do
            _args=(--bucket "$BUCKET" --prefix "$FULL_FOLDER_PATH" --endpoint-url "$ENDPOINT_URL" --region auto --output json --no-cli-pager)
            [[ -n "$_token" ]] && _args+=(--starting-token "$_token")
            _resp=$(aws s3api list-objects-v2 "${_args[@]}")
            _rows=$(echo "$_resp" | jq -r '["Key", "Size", "LastModified", "ContentType"], (.Contents[]? | [.Key, .Size, .LastModified, .ContentType]) | @tsv')
            if [[ -n "$_rows" ]]; then
                if [[ "$_first_page" == true ]]; then
                    echo "$_rows" | column -t -s $'\t'
                    [[ -n "$OUTPUT_FILE" ]] && echo "$_rows" | column -t -s $'\t' >> "$OUTPUT_FILE"
                    _first_page=false
                else
                    echo "$_rows" | tail -n +2 | column -t -s $'\t'
                    [[ -n "$OUTPUT_FILE" ]] && echo "$_rows" | tail -n +2 | column -t -s $'\t' >> "$OUTPUT_FILE"
                fi
            fi
            [[ "$(echo "$_resp" | jq -r '.IsTruncated')" != "true" ]] && break
            _token=$(echo "$_resp" | jq -r '.NextContinuationToken')
        done
    else
        # List just keys recursively (paginated)
        if [[ -n "$OUTPUT_FILE" ]]; then
            print_status "Saving file listing to: $OUTPUT_FILE"
            : > "$OUTPUT_FILE"
            list_all_keys_paginated "$FULL_FOLDER_PATH" "" "$OUTPUT_FILE"
        else
            list_all_keys_paginated "$FULL_FOLDER_PATH" ""
        fi
    fi
else
    print_status "Listing files in current folder only (non-recursive)..."
    
    if [[ "$SHOW_DETAILS" == true ]]; then
        # List with detailed information (current folder only, paginated)
        if [[ -n "$OUTPUT_FILE" ]]; then
            print_status "Saving detailed listing to: $OUTPUT_FILE"
            : > "$OUTPUT_FILE"
        fi
        _first_page=true
        _token=""
        while true; do
            _args=(--bucket "$BUCKET" --prefix "$FULL_FOLDER_PATH" --delimiter "/" --endpoint-url "$ENDPOINT_URL" --region auto --output json --no-cli-pager)
            [[ -n "$_token" ]] && _args+=(--starting-token "$_token")
            _resp=$(aws s3api list-objects-v2 "${_args[@]}")
            _rows=$(echo "$_resp" | jq -r '["Key", "Size", "LastModified", "ContentType"], (.Contents[]? | [.Key, .Size, .LastModified, .ContentType]) | @tsv')
            if [[ -n "$_rows" ]]; then
                if [[ "$_first_page" == true ]]; then
                    echo "$_rows" | column -t -s $'\t'
                    [[ -n "$OUTPUT_FILE" ]] && echo "$_rows" | column -t -s $'\t' >> "$OUTPUT_FILE"
                    _first_page=false
                else
                    echo "$_rows" | tail -n +2 | column -t -s $'\t'
                    [[ -n "$OUTPUT_FILE" ]] && echo "$_rows" | tail -n +2 | column -t -s $'\t' >> "$OUTPUT_FILE"
                fi
            fi
            [[ "$(echo "$_resp" | jq -r '.IsTruncated')" != "true" ]] && break
            _token=$(echo "$_resp" | jq -r '.NextContinuationToken')
        done
        
        print_status ""
        print_status "Subfolders found:"
        SUBFOLDERS_DETAILED=$(list_all_common_prefixes_paginated "$FULL_FOLDER_PATH" "")
        if [[ -n "$SUBFOLDERS_DETAILED" ]]; then
            if [[ -n "$OUTPUT_FILE" ]]; then
                echo "" >> "$OUTPUT_FILE"
                echo "Subfolders found:" >> "$OUTPUT_FILE"
                echo "$SUBFOLDERS_DETAILED" >> "$OUTPUT_FILE"
            fi
            echo "$SUBFOLDERS_DETAILED"
        else
            if [[ -n "$OUTPUT_FILE" ]]; then
                echo "" >> "$OUTPUT_FILE"
                echo "Subfolders found:" >> "$OUTPUT_FILE"
                echo "No subfolders found" >> "$OUTPUT_FILE"
            fi
            print_status "No subfolders found"
        fi
    else
        # List just keys (current folder only, paginated)
        if [[ -n "$OUTPUT_FILE" ]]; then
            print_status "Saving file listing to: $OUTPUT_FILE"
            : > "$OUTPUT_FILE"
            list_all_keys_paginated "$FULL_FOLDER_PATH" "/" "$OUTPUT_FILE"
        else
            list_all_keys_paginated "$FULL_FOLDER_PATH" "/"
        fi
        
        print_status ""
        print_status "Subfolders found:"
        SUBFOLDERS_SIMPLE=$(list_all_common_prefixes_paginated "$FULL_FOLDER_PATH" "")
        if [[ -n "$SUBFOLDERS_SIMPLE" ]]; then
            if [[ -n "$OUTPUT_FILE" ]]; then
                echo "" >> "$OUTPUT_FILE"
                echo "Subfolders found:" >> "$OUTPUT_FILE"
                echo "$SUBFOLDERS_SIMPLE" >> "$OUTPUT_FILE"
            fi
            echo "$SUBFOLDERS_SIMPLE"
        else
            if [[ -n "$OUTPUT_FILE" ]]; then
                echo "" >> "$OUTPUT_FILE"
                echo "Subfolders found:" >> "$OUTPUT_FILE"
                echo "No subfolders found" >> "$OUTPUT_FILE"
            fi
            print_status "No subfolders found"
        fi
    fi
fi

    # Check if the operation was successful
    if [[ $? -eq 0 ]]; then
        if [[ -z "$FULL_FOLDER_PATH" ]]; then
            print_success "Successfully listed contents of bucket root"
        else
            print_success "Successfully listed contents of folder: $FULL_FOLDER_PATH"
        fi
        
        # Show output file info if specified
        if [[ -n "$OUTPUT_FILE" ]]; then
            print_success "File listing saved to: $OUTPUT_FILE"
        fi
        
        # Get summary information
        print_status ""
        print_status "Summary:"
    
    # Skip counting for root listing (too expensive) or use paginated counts
    if [[ -z "$FULL_FOLDER_PATH" ]]; then
        print_status "Counting skipped for root listing (too many files)"
        
        # Count subfolders at root (paginated)
        _counts=$(count_paginated "" "true")
        TOTAL_SUBFOLDERS=${_counts#* }
        print_status "Total root folders: $TOTAL_SUBFOLDERS"
    else
        # Count total objects and subfolders with pagination
        if [[ "$RECURSIVE" == true ]]; then
            _counts=$(count_paginated "$FULL_FOLDER_PATH" "false")
            TOTAL_OBJECTS=${_counts% *}
            TOTAL_SUBFOLDERS=0
        else
            _counts=$(count_paginated "$FULL_FOLDER_PATH" "true")
            TOTAL_OBJECTS=${_counts% *}
            TOTAL_SUBFOLDERS=${_counts#* }
        fi
        
        print_status "Total files: $TOTAL_OBJECTS"
        print_status "Total subfolders: $TOTAL_SUBFOLDERS"
        
        if [[ "$RECURSIVE" == true ]]; then
            print_status "Note: File count includes files in subfolders (recursive listing)"
        fi
    fi
else
    print_error "Failed to list folder contents"
    exit 1
fi
