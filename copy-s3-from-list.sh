#!/bin/bash

# Script to copy S3 objects from a list of source paths to a destination root (same segment count).
# Each line in the list file is a source path; the root of each path is replaced by the destination root.
# Overwrites existing files. Uses environment variables from .dev.vars file.
# Default: dry run. Use --execute to perform the copy.

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

# Ensure path is shown with leading slash when referring to paths
path_slash() {
    local p="$1"
    [[ -n "$p" && "$p" != /* ]] && p="/$p"
    echo "$p"
}

show_usage() {
    echo "Usage: $0 [OPTIONS] <list-file.txt> <destination-root-path>"
    echo ""
    echo "Copies each S3 object listed in the file to a destination path by replacing"
    echo "the root (first N segments) of each source path with the destination root."
    echo "N = number of segments in destination-root-path."
    echo ""
    echo "Options:"
    echo "  -b, --bucket <bucket>     S3 bucket name (default: aem-content)"
    echo "  -o, --org <organization>  Organization prefix for paths"
    echo "  -x, --execute             Actually perform the copy (default is dry run)"
    echo "  -h, --help                Show this help message"
    echo ""
    echo "Example:"
    echo "  list file line:  /aemsites/vitamix/us/en_us/drafts/aanness/index.html"
    echo "  destination root: /aemsites/vitamix/ca/es_mx"
    echo "  -> copies to:     /aemsites/vitamix/ca/es_mx/drafts/aanness/index.html"
    echo ""
    echo "Environment variables (from .dev.vars):"
    echo "  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_DEF_URL"
}

BUCKET="aem-content"
ORG=""
LIST_FILE=""
DEST_ROOT=""
DRY_RUN=true

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
            if [[ -z "$LIST_FILE" ]]; then
                LIST_FILE="$1"
            elif [[ -z "$DEST_ROOT" ]]; then
                DEST_ROOT="$1"
            else
                print_error "Too many arguments"
                show_usage
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$LIST_FILE" ]] || [[ -z "$DEST_ROOT" ]]; then
    print_error "Missing required arguments: list file and destination root path"
    show_usage
    exit 1
fi

if [[ ! -f "$LIST_FILE" ]]; then
    print_error "List file not found: $LIST_FILE"
    exit 1
fi

# Normalize: strip leading slash for S3 keys
[[ "$DEST_ROOT" == "/" ]] && DEST_ROOT=""
DEST_ROOT_NOSLASH="${DEST_ROOT#/}"
# Segment count of destination root (e.g. aemsites/vitamix/ca/es_mx -> 4)
DEST_SEGMENT_COUNT=0
if [[ -n "$DEST_ROOT_NOSLASH" ]]; then
    IFS=/ read -ra DEST_SEGS <<< "$DEST_ROOT_NOSLASH"
    DEST_SEGMENT_COUNT=${#DEST_SEGS[@]}
fi

if [[ $DEST_SEGMENT_COUNT -eq 0 ]]; then
    print_error "Destination root must have at least one segment (e.g. aemsites/vitamix/ca/es_mx)"
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

if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    exit 1
fi

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"
ENDPOINT_URL="$S3_DEF_URL"

# Build list of source_key|dest_key pairs (keys without leading slash)
PAIRS=""
while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" ]] && continue
    source_noslash="${line#/}"
    segs=()
    IFS=/ read -ra segs <<< "$source_noslash"
    n=${#segs[@]}
    if [[ $n -le $DEST_SEGMENT_COUNT ]]; then
        print_warning "Skipping (not enough segments): $(path_slash "$line")"
        continue
    fi
    rest_segs=("${segs[@]:$DEST_SEGMENT_COUNT}")
    rest=$(IFS=/; echo "${rest_segs[*]}")
    if [[ -n "$ORG" ]]; then
        source_key="$ORG/$source_noslash"
        dest_key="$ORG/$DEST_ROOT_NOSLASH/$rest"
    else
        source_key="$source_noslash"
        dest_key="$DEST_ROOT_NOSLASH/$rest"
    fi
    PAIRS="$PAIRS${source_key}|${dest_key}"$'\n'
done < "$LIST_FILE"

PAIRS="${PAIRS%$'\n'}"
FILE_COUNT=$(echo "$PAIRS" | grep -c . || true)

if [[ $FILE_COUNT -eq 0 ]]; then
    print_warning "No valid source paths in list file: $LIST_FILE"
    exit 0
fi

COPIED_FILE="copied-from-list.txt"

if [[ "$DRY_RUN" == true ]]; then
    print_warning "DRY RUN (no changes will be made). Use -x or --execute to perform the copy."
    print_status "Found $FILE_COUNT path(s). Would copy to destination root: $(path_slash "$DEST_ROOT_NOSLASH")"
    : > "$COPIED_FILE"
    echo ""
    while IFS='|' read -r src dst; do
        [[ -z "$src" ]] && continue
        print_status "  Would copy: $(path_slash "$src") -> $(path_slash "$dst")"
        echo "$(path_slash "$dst")" >> "$COPIED_FILE"
    done <<< "$PAIRS"
    echo ""
    print_status "Summary: $FILE_COUNT path(s) would be copied. Run with --execute to perform."
    print_status "List of would-be copied keys saved to: $COPIED_FILE"
    exit 0
fi

: > "$COPIED_FILE"
PARALLEL_JOBS=10
TEMP_DIR=$(mktemp -d)
FAILED_FILE="$TEMP_DIR/failed.txt"
: > "$FAILED_FILE"
trap 'rm -rf "$TEMP_DIR"' EXIT

lock() { while ! mkdir "$TEMP_DIR/lock" 2>/dev/null; do sleep 0.01; done; }
unlock() { rmdir "$TEMP_DIR/lock" 2>/dev/null; }

print_status "Found $FILE_COUNT path(s). Copying (destination root: $(path_slash "$DEST_ROOT_NOSLASH"), up to $PARALLEL_JOBS in parallel)"
print_status "Copy log will be written to: $COPIED_FILE"
echo ""

keys_batch=()
while IFS='|' read -r src dst; do
    [[ -z "$src" ]] && continue
    keys_batch+=("$src|$dst")
    if [[ ${#keys_batch[@]} -eq $PARALLEL_JOBS ]]; then
        for pair in "${keys_batch[@]}"; do
            IFS='|' read -r k d <<< "$pair"
            (
                if aws s3api copy-object \
                    --bucket "$BUCKET" \
                    --copy-source "$BUCKET/$k" \
                    --key "$d" \
                    --endpoint-url "$ENDPOINT_URL" \
                    --region auto \
                    --no-cli-pager &>/dev/null; then
                    lock; echo "$(path_slash "$d")" >> "$COPIED_FILE"; unlock
                    print_success "Copied: $(path_slash "$k") -> $(path_slash "$d")"
                else
                    lock; echo "$(path_slash "$k")" >> "$FAILED_FILE"; unlock
                    print_error "Failed to copy: $(path_slash "$k")"
                fi
            ) &
        done
        wait
        keys_batch=()
    fi
done <<< "$PAIRS"

for pair in "${keys_batch[@]}"; do
    IFS='|' read -r k d <<< "$pair"
    (
        if aws s3api copy-object \
            --bucket "$BUCKET" \
            --copy-source "$BUCKET/$k" \
            --key "$d" \
            --endpoint-url "$ENDPOINT_URL" \
            --region auto \
            --no-cli-pager &>/dev/null; then
            lock; echo "$(path_slash "$d")" >> "$COPIED_FILE"; unlock
            print_success "Copied: $(path_slash "$k") -> $(path_slash "$d")"
        else
            lock; echo "$(path_slash "$k")" >> "$FAILED_FILE"; unlock
            print_error "Failed to copy: $(path_slash "$k")"
        fi
    ) &
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
