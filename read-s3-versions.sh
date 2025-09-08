#!/bin/bash

# S3 Document Versions Reader Script
# Usage: ./read-versions.sh <document-path> [bucket-name]
# Note: bucket-name defaults to "aem-content" if not specified
#
# This script reads a document's metadata, extracts the Metadata/id,
# and lists all version files in the corresponding .da-versions folder

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
    echo "Usage: $0 <document-path> [bucket-name]"
    echo ""
    echo "Arguments:"
    echo "  document-path  Path to the document within the bucket (required)"
    echo "  bucket-name    Name of the S3 bucket (optional, defaults to 'aem-content')"
    echo ""
    echo "Examples:"
    echo "  $0 kptdobe/daplayground/version/test.html"
    echo "  $0 folder/file.txt"
    echo "  $0 config/settings.json aem-content"
    echo ""
    echo "The script will read the document metadata, extract the ID, and list all"
    echo "version files in the corresponding .da-versions folder."
}

# Function to check if AWS CLI is installed
check_aws_cli() {
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed. Please install it first:"
        echo "  macOS: brew install awscli"
        echo "  Ubuntu/Debian: sudo apt-get install awscli"
        echo "  CentOS/RHEL: sudo yum install awscli"
        exit 1
    fi
}

# Function to load environment variables from .dev.vars
load_env_vars() {
    if [[ ! -f ".dev.vars" ]]; then
        print_error ".dev.vars file not found in current directory"
        exit 1
    fi
    
    print_status "Loading environment variables from .dev.vars"
    
    # Source the .dev.vars file
    export $(grep -v '^#' .dev.vars | xargs)
    
    # Verify required variables are set
    if [[ -z "$S3_ACCESS_KEY_ID" || -z "$S3_SECRET_ACCESS_KEY" || -z "$S3_DEF_URL" ]]; then
        print_error "Required S3 environment variables not found in .dev.vars"
        echo "Required: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_DEF_URL"
        exit 1
    fi
    
    print_success "Environment variables loaded successfully"
}

# Function to configure AWS CLI
configure_aws() {
    print_status "Configuring AWS CLI with S3 credentials"
    
    # Set AWS credentials
    export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
    export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
    
    # For Cloudflare R2, use the S3_DEF_URL directly as the endpoint
    export AWS_ENDPOINT_URL="$S3_DEF_URL"
    
    # Disable AWS CLI pager to make output non-interactive
    export AWS_PAGER=""
    
    print_success "AWS CLI configured successfully"
}

# Function to extract the ID from document metadata
extract_metadata_id() {
    local bucket_name="$1"
    local document_path="$2"
    
    # Get the full metadata and extract the ID
    local metadata_json=$(aws s3api head-object --bucket "$bucket_name" --key "$document_path" --endpoint-url "$AWS_ENDPOINT_URL" --output json)
    
    # Extract the ID from the Metadata field
    local id=$(echo "$metadata_json" | jq -r '.Metadata.id // empty')
    
    if [[ -z "$id" || "$id" == "null" ]]; then
        print_error "No Metadata/id found in document metadata"
        echo "Available metadata fields:"
        echo "$metadata_json" | jq -r '.Metadata // {}'
        exit 1
    fi
    
    # Return the ID without echoing it (to avoid mixing with other output)
    printf '%s' "$id"
}

# Function to construct the .da-versions folder path
construct_versions_path() {
    local document_path="$1"
    local id="$2"
    
    # Extract the root path (first part before the first slash)
    local root_path=$(echo "$document_path" | cut -d'/' -f1)
    
    # Construct the .da-versions path at the root level
    local versions_path="${root_path}/.da-versions/${id}/"
    
    # Return the path without echoing it (to avoid mixing with other output)
    printf '%s' "$versions_path"
}

# Function to list version files
list_version_files() {
    local bucket_name="$1"
    local versions_path="$2"
    
    print_status "Listing version files in: s3://$bucket_name/$versions_path"
    echo ""
    echo "=== Version Files ==="
    
    # List files in the versions folder (no recursive needed - files are directly under version/id)
    print_status "Listing files in: s3://$bucket_name/$versions_path"
    
    local list_output=$(aws s3 ls "s3://$bucket_name/$versions_path" --endpoint-url "$AWS_ENDPOINT_URL" 2>&1)
    
    # Check for AWS errors
    if echo "$list_output" | grep -q "An error occurred"; then
        print_error "AWS error occurred while listing files:"
        echo "$list_output"
        return 1
    fi
    
    if [[ -z "$list_output" ]]; then
        print_warning "No files found in versions folder"
        print_status "Trying to list parent directory to verify structure..."
        local parent_path=$(dirname "$versions_path")
        aws s3 ls "s3://$bucket_name/$parent_path" --endpoint-url "$AWS_ENDPOINT_URL"
        return 1
    else
        print_success "Found files in versions folder"
    fi
    
    # Display the files with formatted output, sorted by modification date (most recent first)
    local files_to_display="$list_output"
    
    # Sort by modification date (most recent first)
    # S3 ls output format: "date time size filename"
    # We'll sort by date (field 1) and time (field 2) in descending order
    echo "$files_to_display" | sort -k1,2 -r | while IFS= read -r line; do
        if [[ -n "$line" ]]; then
            # Parse the S3 ls output format: "date time size filename"
            local date=$(echo "$line" | awk '{print $1}')
            local time=$(echo "$line" | awk '{print $2}')
            local size=$(echo "$line" | awk '{print $3}')
            local filename=$(echo "$line" | awk '{print $4}' | sed "s|^$versions_path||")
            
            # Format size in human readable format
            local size_human=""
            if [[ "$size" =~ ^[0-9]+$ ]]; then
                if [[ $size -lt 1024 ]]; then
                    size_human="${size}B"
                elif [[ $size -lt 1048576 ]]; then
                    size_human="$(($size / 1024))KB"
                elif [[ $size -lt 1073741824 ]]; then
                    size_human="$(($size / 1048576))MB"
                else
                    size_human="$(($size / 1073741824))GB"
                fi
            else
                size_human="$size"
            fi
            
            printf "%-30s %-10s %s %s\n" "$filename" "$size_human" "$date" "$time"
        fi
    done
    
    echo ""
    echo "=== End of Version Files ==="
}

# Main script execution
main() {
    # Check arguments
    if [[ $# -lt 1 ]]; then
        print_error "Insufficient arguments"
        show_usage
        exit 1
    fi
    
    local document_path="$1"
    local bucket_name="${2:-aem-content}"  # Default to aem-content if not specified
    
    # Remove leading slash if present and convert to lowercase
    document_path="${document_path#/}"
    document_path=$(echo "$document_path" | tr '[:upper:]' '[:lower:]')
    
    print_status "Starting S3 document versions reader"
    print_status "Bucket: $bucket_name"
    print_status "Document path: $document_path (converted to lowercase)"
    echo ""
    
    # Check prerequisites
    check_aws_cli
    
    # Check if jq is installed (needed for JSON parsing)
    if ! command -v jq &> /dev/null; then
        print_error "jq is not installed. Please install it first:"
        echo "  macOS: brew install jq"
        echo "  Ubuntu/Debian: sudo apt-get install jq"
        echo "  CentOS/RHEL: sudo yum install jq"
        exit 1
    fi
    
    # Load environment variables
    load_env_vars
    
    # Configure AWS CLI
    configure_aws
    
    # Check if the document exists
    if ! aws s3api head-object --bucket "$bucket_name" --key "$document_path" --endpoint-url "$AWS_ENDPOINT_URL" &> /dev/null; then
        print_error "Document not found: s3://$bucket_name/$document_path"
        exit 1
    fi
    
    print_success "Document exists"
    
    # Extract the ID from metadata
    print_status "Reading document metadata to extract ID..."
    local id=$(extract_metadata_id "$bucket_name" "$document_path")
    print_success "Found ID: $id"
    
    # Construct the versions folder path
    local versions_path=$(construct_versions_path "$document_path" "$id")
    print_status "Versions folder path: $versions_path"
    
    # List version files
    list_version_files "$bucket_name" "$versions_path"
    
    print_success "Script completed successfully"
}

# Handle help flag
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

# Run main function with all arguments
main "$@"
