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
if [[ -z "$FOLDER_PATH" ]]; then
    print_error "Missing required argument: folder path"
    show_usage
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

# Ensure folder path ends with / for proper S3 listing
if [[ ! "$FULL_FOLDER_PATH" =~ /$ ]]; then
    FULL_FOLDER_PATH="$FULL_FOLDER_PATH/"
fi

print_status "Listing contents of folder: $FULL_FOLDER_PATH"
print_status "Bucket: $BUCKET"
print_status "Recursive: $RECURSIVE"
print_status "Show details: $SHOW_DETAILS"

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

# Extract endpoint URL from S3_DEF_URL (remove https:// prefix if present)
ENDPOINT_URL="$S3_DEF_URL"

# List objects in the folder
print_status "Executing AWS CLI command to list folder contents..."

if [[ "$RECURSIVE" == true ]]; then
    print_status "Listing files recursively (including subfolders)..."
    
    if [[ "$SHOW_DETAILS" == true ]]; then
        # List with detailed information recursively
        if [[ -n "$OUTPUT_FILE" ]]; then
            print_status "Saving detailed listing to: $OUTPUT_FILE"
            aws s3api list-objects-v2 \
                --bucket "$BUCKET" \
                --prefix "$FULL_FOLDER_PATH" \
                --endpoint-url "$ENDPOINT_URL" \
                --region auto \
                --query 'Contents[].{Key: Key, Size: Size, LastModified: LastModified, ContentType: ContentType}' \
                --output table \
                --no-cli-pager | tee "$OUTPUT_FILE"
        else
            aws s3api list-objects-v2 \
                --bucket "$BUCKET" \
                --prefix "$FULL_FOLDER_PATH" \
                --endpoint-url "$ENDPOINT_URL" \
                --region auto \
                --query 'Contents[].{Key: Key, Size: Size, LastModified: LastModified, ContentType: ContentType}' \
                --output table \
                --no-cli-pager
        fi
    else
        # List just keys recursively
        if [[ -n "$OUTPUT_FILE" ]]; then
            print_status "Saving file listing to: $OUTPUT_FILE"
            aws s3api list-objects-v2 \
                --bucket "$BUCKET" \
                --prefix "$FULL_FOLDER_PATH" \
                --endpoint-url "$ENDPOINT_URL" \
                --region auto \
                --query 'Contents[].Key' \
                --output text \
                --no-cli-pager | tr '\t' '\n' | tee "$OUTPUT_FILE"
        else
            aws s3api list-objects-v2 \
                --bucket "$BUCKET" \
                --prefix "$FULL_FOLDER_PATH" \
                --endpoint-url "$ENDPOINT_URL" \
                --region auto \
                --query 'Contents[].Key' \
                --output text \
                --no-cli-pager | tr '\t' '\n'
        fi
    fi
else
    print_status "Listing files in current folder only (non-recursive)..."
    
    if [[ "$SHOW_DETAILS" == true ]]; then
        # List with detailed information (current folder only)
        if [[ -n "$OUTPUT_FILE" ]]; then
            print_status "Saving detailed listing to: $OUTPUT_FILE"
            aws s3api list-objects-v2 \
                --bucket "$BUCKET" \
                --prefix "$FULL_FOLDER_PATH" \
                --delimiter "/" \
                --endpoint-url "$ENDPOINT_URL" \
                --region auto \
                --query 'Contents[].{Key: Key, Size: Size, LastModified: LastModified, ContentType: ContentType}' \
                --output table \
                --no-cli-pager | tee "$OUTPUT_FILE"
        else
            aws s3api list-objects-v2 \
                --bucket "$BUCKET" \
                --prefix "$FULL_FOLDER_PATH" \
                --delimiter "/" \
                --endpoint-url "$ENDPOINT_URL" \
                --region auto \
                --query 'Contents[].{Key: Key, Size: Size, LastModified: LastModified, ContentType: ContentType}' \
                --output table \
                --no-cli-pager
        fi
        
        print_status ""
        print_status "Subfolders found:"
        SUBFOLDERS_DETAILED=$(aws s3api list-objects-v2 \
            --bucket "$BUCKET" \
            --prefix "$FULL_FOLDER_PATH" \
            --delimiter "/" \
            --endpoint-url "$ENDPOINT_URL" \
            --region auto \
            --query 'CommonPrefixes[].Prefix' \
            --output text \
            --no-cli-pager)
        
        if [[ -n "$SUBFOLDERS_DETAILED" ]]; then
            if [[ -n "$OUTPUT_FILE" ]]; then
                echo "" >> "$OUTPUT_FILE"
                echo "Subfolders found:" >> "$OUTPUT_FILE"
                echo "$SUBFOLDERS_DETAILED" >> "$OUTPUT_FILE"
            fi
            echo "$SUBFOLDERS_DETAILED" | tr '\t' '\n'
        else
            if [[ -n "$OUTPUT_FILE" ]]; then
                echo "" >> "$OUTPUT_FILE"
                echo "Subfolders found:" >> "$OUTPUT_FILE"
                echo "No subfolders found" >> "$OUTPUT_FILE"
            fi
            print_status "No subfolders found"
        fi
    else
        # List just keys (current folder only)
        if [[ -n "$OUTPUT_FILE" ]]; then
            print_status "Saving file listing to: $OUTPUT_FILE"
            aws s3api list-objects-v2 \
                --bucket "$BUCKET" \
                --prefix "$FULL_FOLDER_PATH" \
                --delimiter "/" \
                --endpoint-url "$ENDPOINT_URL" \
                --region auto \
                --query 'Contents[].Key' \
                --output text \
                --no-cli-pager | tr '\t' '\n' | tee "$OUTPUT_FILE"
        else
            aws s3api list-objects-v2 \
                --bucket "$BUCKET" \
                --prefix "$FULL_FOLDER_PATH" \
                --delimiter "/" \
                --region auto \
                --query 'Contents[].Key' \
                --output text \
                --no-cli-pager | tr '\t' '\n'
        fi
        
        print_status ""
        print_status "Subfolders found:"
        SUBFOLDERS_SIMPLE=$(aws s3api list-objects-v2 \
            --bucket "$BUCKET" \
            --prefix "$FULL_FOLDER_PATH" \
            --delimiter "/" \
            --endpoint-url "$ENDPOINT_URL" \
            --region auto \
            --query 'CommonPrefixes[].Prefix' \
            --output text \
            --no-cli-pager)
        
        if [[ -n "$SUBFOLDERS_SIMPLE" ]]; then
            if [[ -n "$OUTPUT_FILE" ]]; then
                echo "" >> "$OUTPUT_FILE"
                echo "Subfolders found:" >> "$OUTPUT_FILE"
                echo "$SUBFOLDERS_SIMPLE" | tr '\t' '\n' >> "$OUTPUT_FILE"
            fi
            echo "$SUBFOLDERS_SIMPLE" | tr '\t' '\n'
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
        print_success "Successfully listed contents of folder: $FULL_FOLDER_PATH"
        
        # Show output file info if specified
        if [[ -n "$OUTPUT_FILE" ]]; then
            print_success "File listing saved to: $OUTPUT_FILE"
        fi
        
        # Get summary information
        print_status ""
        print_status "Summary:"
    
    # Count total objects - handle null case
    TOTAL_OBJECTS=$(aws s3api list-objects-v2 \
        --bucket "$BUCKET" \
        --prefix "$FULL_FOLDER_PATH" \
        --endpoint-url "$ENDPOINT_URL" \
        --region auto \
        --query 'length(Contents || `[]`)' \
        --output text \
        --no-cli-pager)
    
    # Count subfolders (non-recursive) - handle null case
    TOTAL_SUBFOLDERS=$(aws s3api list-objects-v2 \
        --bucket "$BUCKET" \
        --prefix "$FULL_FOLDER_PATH" \
        --delimiter "/" \
        --endpoint-url "$ENDPOINT_URL" \
        --region auto \
        --query 'length(CommonPrefixes || `[]`)' \
        --output text \
        --no-cli-pager)
    
    print_status "Total files: $TOTAL_OBJECTS"
    print_status "Total subfolders: $TOTAL_SUBFOLDERS"
    
    if [[ "$RECURSIVE" == true ]]; then
        print_status "Note: File count includes files in subfolders (recursive listing)"
    fi
else
    print_error "Failed to list folder contents"
    exit 1
fi
