#!/bin/bash

# Script to update content type metadata of S3 resources in aem-content bucket
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
    echo "Usage: $0 [OPTIONS] <object-key> <content-type>"
    echo ""
    echo "Options:"
    echo "  -b, --bucket <bucket>     S3 bucket name (default: aem-content)"
    echo "  -o, --org <organization>  Organization prefix for object key"
    echo "  -h, --help                Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 'path/to/file.jpg' 'image/jpeg'"
    echo "  $0 -o 'myorg' 'document.pdf' 'application/pdf'"
    echo "  $0 -b 'my-bucket' 'image.png' 'image/png'"
    echo ""
    echo "Environment variables (from .dev.vars):"
    echo "  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_DEF_URL"
}

# Default values
BUCKET="aem-content"
ORG=""
OBJECT_KEY=""
CONTENT_TYPE=""

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
            if [[ -z "$OBJECT_KEY" ]]; then
                OBJECT_KEY="$1"
            elif [[ -z "$CONTENT_TYPE" ]]; then
                CONTENT_TYPE="$1"
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
if [[ -z "$OBJECT_KEY" ]] || [[ -z "$CONTENT_TYPE" ]]; then
    print_error "Missing required arguments"
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

# Construct the full object key
FULL_OBJECT_KEY="$OBJECT_KEY"
if [[ -n "$ORG" ]]; then
    FULL_OBJECT_KEY="$ORG/$OBJECT_KEY"
fi

print_status "Updating content type metadata for object: $FULL_OBJECT_KEY"
print_status "Bucket: $BUCKET"
print_status "Content Type: $CONTENT_TYPE"

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

# Update the object metadata using AWS CLI
print_status "Executing AWS CLI command..."

# Let's try a completely different approach
# Instead of copy-object which always wipes metadata, let's use a different strategy

# Show current metadata
print_status "Current metadata before update:"
aws s3api head-object \
    --bucket "$BUCKET" \
    --key "$FULL_OBJECT_KEY" \
    --endpoint-url "$ENDPOINT_URL" \
    --region auto \
    --no-cli-pager

print_status ""
print_status "Reading all existing metadata..."

# Get all existing metadata
METADATA_JSON=$(aws s3api head-object \
    --bucket "$BUCKET" \
    --key "$FULL_OBJECT_KEY" \
    --endpoint-url "$ENDPOINT_URL" \
    --region auto \
    --output json \
    --no-cli-pager)

if [[ $? -eq 0 ]]; then
    print_status "Successfully retrieved metadata"
    
    # Extract custom metadata (x-amz-meta-* fields)
    METADATA_ARGS=()
    
    # Simple approach: just get the metadata values directly
    print_status "Extracting metadata values..."
    
    # Get the metadata section and extract key-value pairs
    METADATA_SECTION=$(echo "$METADATA_JSON" | grep -A 20 '"Metadata"' | grep -v '"Metadata":' | grep -v '^[[:space:]]*[{}]')
    
    print_status "Metadata section found:"
    echo "$METADATA_SECTION"
    
    # Parse each metadata line
    while IFS= read -r line; do
        # Use a more robust regex that captures the entire value
        if [[ $line =~ ^[[:space:]]*\"([^\"]+)\":[[:space:]]*(.+)$ ]]; then
            key="${BASH_REMATCH[1]}"
            value="${BASH_REMATCH[2]}"
            
            # Clean up the value: remove trailing comma and surrounding quotes
            value=$(echo "$value" | sed 's/,$//' | sed 's/^"//' | sed 's/"$//')
            
            if [[ -n "$key" ]] && [[ -n "$value" ]]; then
                # Build JSON metadata format instead of comma-separated
                # This handles special characters better than comma-separated format
                if [[ -n "$METADATA_OUTPUT" ]]; then
                    METADATA_OUTPUT="$METADATA_OUTPUT,\"$key\":\"$value\""
                else
                    METADATA_OUTPUT="\"$key\":\"$value\""
                fi
                print_status "Found metadata: $key=$value"
            fi
        fi
    done < <(echo "$METADATA_SECTION")
    
    # Complete the JSON format
    if [[ -n "$METADATA_OUTPUT" ]]; then
        METADATA_OUTPUT="{$METADATA_OUTPUT}"
    fi
    
    print_status "Metadata JSON: $METADATA_OUTPUT"
    
    # Fix the condition check - check if metadata JSON is not empty
    if [[ -n "$METADATA_OUTPUT" ]]; then
        print_status "Will preserve custom metadata: $METADATA_OUTPUT"
        
        print_status "Copying object with updated content type and ALL preserved metadata..."
        
        # Copy object to itself with ALL metadata preserved and new content type
        aws s3api copy-object \
            --bucket "$BUCKET" \
            --copy-source "$BUCKET/$FULL_OBJECT_KEY" \
            --key "$FULL_OBJECT_KEY" \
            --metadata-directive REPLACE \
            --content-type "$CONTENT_TYPE" \
            --endpoint-url "$ENDPOINT_URL" \
            --region auto \
            --metadata "$METADATA_OUTPUT" \
            --no-cli-pager
    else
        print_status "No custom metadata found, updating content type only..."
        
        # Update just the content type
        aws s3api copy-object \
            --bucket "$BUCKET" \
            --copy-source "$BUCKET/$FULL_OBJECT_KEY" \
            --key "$FULL_OBJECT_KEY" \
            --metadata-directive REPLACE \
            --content-type "$CONTENT_TYPE" \
            --endpoint-url "$ENDPOINT_URL" \
            --region auto \
            --no-cli-pager
    fi
    
    # Check if the operation was successful
    if [[ $? -eq 0 ]]; then
        print_success "Successfully updated content type metadata for $FULL_OBJECT_KEY"
        print_status "New content type: $CONTENT_TYPE"
        
        # Verify the change by getting object metadata
        print_status "Verifying the change..."
        print_status "Updated metadata:"
        aws s3api head-object \
            --bucket "$BUCKET" \
            --key "$FULL_OBJECT_KEY" \
            --endpoint-url "$ENDPOINT_URL" \
            --region auto \
            --no-cli-pager
            
        print_status ""
        print_status "Verifying custom metadata was preserved:"
        aws s3api head-object \
            --bucket "$BUCKET" \
            --key "$FULL_OBJECT_KEY" \
            --endpoint-url "$ENDPOINT_URL" \
            --region auto \
            --query 'Metadata' \
            --output json \
            --no-cli-pager
    else
        print_error "Failed to update content type metadata"
        exit 1
    fi
else
    print_error "Failed to retrieve metadata"
    exit 1
fi
