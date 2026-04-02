#!/bin/bash

# Script to delete all files in a given S3 folder (recursive)
# By default, only lists what would be deleted (dry-run).
# Use -x to actually delete.

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

show_usage() {
    echo "Usage: $0 [OPTIONS] <folder-path>"
    echo ""
    echo "Options:"
    echo "  -b, --bucket <bucket>     S3 bucket name (default: aem-content)"
    echo "  -o, --org <organization>  Organization prefix for folder path"
    echo "  -x, --execute             Actually delete (default is dry-run: list only)"
    echo "  -h, --help                Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 'images/'               # Dry-run: list what would be deleted"
    echo "  $0 -x 'images/'            # Actually delete all files under images/"
    echo "  $0 -o 'myorg' -x 'docs/'   # Delete docs/ under myorg/"
    echo "  $0 -b 'my-bucket' -x 'uploads/'"
    echo ""
    echo "Environment variables (from .dev.vars):"
    echo "  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_DEF_URL"
}

# Default values
BUCKET="aem-content"
ORG=""
FOLDER_PATH=""
EXECUTE=false

ORIGINAL_ARG_COUNT=$#

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
            EXECUTE=true
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

if [[ $ORIGINAL_ARG_COUNT -eq 0 ]]; then
    print_error "Missing required argument: folder path"
    show_usage
    exit 1
fi

if [[ -z "$FOLDER_PATH" ]] || [[ "$FOLDER_PATH" == "/" ]]; then
    print_error "Refusing to delete bucket root. Specify a non-empty folder path."
    exit 1
fi

# Load environment variables from .dev.vars
if [[ -f ".dev.vars" ]]; then
    print_status "Loading environment variables from .dev.vars"
    export $(grep -v '^#' .dev.vars | xargs)
else
    print_error ".dev.vars file not found"
    exit 1
fi

if [[ -z "$S3_ACCESS_KEY_ID" ]] || [[ -z "$S3_SECRET_ACCESS_KEY" ]] || [[ -z "$S3_DEF_URL" ]]; then
    print_error "Missing required environment variables: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, or S3_DEF_URL"
    exit 1
fi

# Construct the full folder path
FULL_FOLDER_PATH="$FOLDER_PATH"
if [[ -n "$ORG" ]]; then
    FULL_FOLDER_PATH="$ORG/$FOLDER_PATH"
fi

# Ensure folder path ends with /
if [[ ! "$FULL_FOLDER_PATH" =~ /$ ]]; then
    FULL_FOLDER_PATH="$FULL_FOLDER_PATH/"
fi

# Check dependencies
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed."
    exit 1
fi

if ! command -v jq &> /dev/null; then
    print_error "jq is required. Install with: brew install jq"
    exit 1
fi

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"
ENDPOINT_URL="$S3_DEF_URL"

print_status "Bucket: $BUCKET"
print_status "Folder: $FULL_FOLDER_PATH"

if [[ "$EXECUTE" == false ]]; then
    print_warning "DRY-RUN mode: listing objects that would be deleted (use -x to actually delete)"
fi

# Collect all keys via paginated listing
ALL_KEYS=()
token=""
while true; do
    args=(--bucket "$BUCKET" --prefix "$FULL_FOLDER_PATH" --endpoint-url "$ENDPOINT_URL" --region auto --output json --no-cli-pager)
    [[ -n "$token" ]] && args+=(--starting-token "$token")
    resp=$(aws s3api list-objects-v2 "${args[@]}")
    keys=$(echo "$resp" | jq -r '.Contents[]?.Key // empty')
    while IFS= read -r key; do
        [[ -n "$key" ]] && ALL_KEYS+=("$key")
    done <<< "$keys"
    [[ "$(echo "$resp" | jq -r '.IsTruncated')" != "true" ]] && break
    token=$(echo "$resp" | jq -r '.NextContinuationToken')
done

TOTAL=${#ALL_KEYS[@]}

if [[ $TOTAL -eq 0 ]]; then
    print_warning "No objects found under: $FULL_FOLDER_PATH"
    exit 0
fi

print_status "Found $TOTAL object(s):"
for key in "${ALL_KEYS[@]}"; do
    echo "  $key"
done

if [[ "$EXECUTE" == false ]]; then
    echo ""
    print_warning "Dry-run complete. $TOTAL object(s) would be deleted. Re-run with -x to delete."
    exit 0
fi

echo ""
print_warning "Deleting $TOTAL object(s) from s3://$BUCKET/$FULL_FOLDER_PATH ..."

# Delete in batches of 1000 (S3 delete-objects limit)
BATCH_SIZE=1000
DELETED=0
ERRORS=0

for (( i=0; i<TOTAL; i+=BATCH_SIZE )); do
    batch=("${ALL_KEYS[@]:$i:$BATCH_SIZE}")
    objects_json=$(printf '%s\n' "${batch[@]}" | jq -Rn '[inputs | {Key: .}]')
    delete_payload=$(jq -n --argjson objs "$objects_json" '{Objects: $objs, Quiet: true}')

    result=$(aws s3api delete-objects \
        --bucket "$BUCKET" \
        --delete "$delete_payload" \
        --endpoint-url "$ENDPOINT_URL" \
        --region auto \
        --output json \
        --no-cli-pager)

    batch_errors=$(echo "$result" | jq -r '.Errors[]?.Key // empty')
    if [[ -n "$batch_errors" ]]; then
        while IFS= read -r err_key; do
            print_error "Failed to delete: $err_key"
            ERRORS=$((ERRORS + 1))
        done <<< "$batch_errors"
        DELETED=$((DELETED + ${#batch[@]} - $(echo "$batch_errors" | wc -l | tr -d ' ')))
    else
        DELETED=$((DELETED + ${#batch[@]}))
    fi
done

echo ""
if [[ $ERRORS -eq 0 ]]; then
    print_success "Deleted $DELETED object(s) from s3://$BUCKET/$FULL_FOLDER_PATH"
else
    print_warning "Deleted $DELETED object(s), $ERRORS error(s) encountered."
    exit 1
fi
