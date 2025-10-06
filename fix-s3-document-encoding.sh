#!/bin/bash

# S3 Document Encoding Fixer Script
# Usage: ./fix-s3-document-encoding.sh <document-path> [bucket-name]
# Note: bucket-name defaults to "aem-content" if not specified
# This script removes gzip content-encoding from S3 documents while preserving all metadata

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
    echo "Description:"
    echo "  This script fixes gzip-encoded S3 documents by:"
    echo "  1. Checking if the document has gzip content-encoding"
    echo "  2. Downloading and decompressing the document"
    echo "  3. Re-uploading without gzip encoding (with -fix suffix)"
    echo "  4. Preserving all original metadata"
    echo ""
    echo "Examples:"
    echo "  $0 documents/report.html"
    echo "  $0 folder/file.json"
    echo "  $0 config/settings.xml aem-content"
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

# Function to check if jq is installed
check_jq() {
    if ! command -v jq &> /dev/null; then
        print_error "jq is not installed. Please install it first:"
        echo "  macOS: brew install jq"
        echo "  Ubuntu/Debian: sudo apt-get install jq"
        echo "  CentOS/RHEL: sudo yum install jq"
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

# Function to fix document encoding
fix_document_encoding() {
    local bucket_name="$1"
    local document_path="$2"
    
    print_status "Checking document: s3://$bucket_name/$document_path"
    
    # Check if the object exists
    if ! aws s3api head-object --bucket "$bucket_name" --key "$document_path" --endpoint-url "$AWS_ENDPOINT_URL" &> /dev/null; then
        print_error "Document not found: s3://$bucket_name/$document_path"
        exit 1
    fi
    
    print_success "Document exists"
    
    # Get object metadata using Node.js SDK (more reliable than AWS CLI for ContentEncoding)
    print_status "Getting document metadata using Node.js SDK..."
    local node_helper="$SCRIPT_DIR/admin/backend/check-encoding-node.js"
    
    if [[ ! -f "$node_helper" ]]; then
        print_error "Node.js helper script not found: $node_helper"
        exit 1
    fi
    
    local metadata_json=$(cd "$SCRIPT_DIR/admin/backend" && node check-encoding-node.js "$bucket_name" "$document_path" 2>&1)
    
    if [[ $? -ne 0 ]]; then
        print_error "Failed to get metadata using Node.js SDK"
        echo "$metadata_json"
        exit 1
    fi
    
    # Extract content encoding and type
    local content_encoding=$(echo "$metadata_json" | jq -r '.ContentEncoding // "None"')
    local content_type=$(echo "$metadata_json" | jq -r '.ContentType // "application/octet-stream"')
    local custom_metadata=$(echo "$metadata_json" | jq -r '.Metadata // {}')
    
    print_status "Content-Type: $content_type"
    print_status "Content-Encoding: $content_encoding"
    
    # Check if document is gzip-encoded
    if [[ "$content_encoding" != "gzip" ]]; then
        print_warning "Document is not gzip-encoded (Content-Encoding: $content_encoding)"
        print_status "No action needed. Exiting."
        exit 0
    fi
    
    print_success "Document is gzip-encoded. Proceeding with fix..."
    
    # Create temporary directory
    local temp_dir=$(mktemp -d)
    local temp_downloaded="$temp_dir/downloaded"
    local temp_decompressed="$temp_dir/decompressed"
    
    # Download the document (AWS CLI may auto-decompress)
    print_status "Downloading document..."
    if ! aws s3api get-object --bucket "$bucket_name" --key "$document_path" --endpoint-url "$AWS_ENDPOINT_URL" "$temp_downloaded" >/dev/null 2>&1; then
        print_error "Failed to download document"
        rm -rf "$temp_dir"
        exit 1
    fi
    print_success "Downloaded successfully"
    
    # Check if the downloaded file is actually gzip-compressed or already decompressed
    print_status "Checking if file needs decompression..."
    if gunzip -t "$temp_downloaded" 2>/dev/null; then
        # File is gzip-compressed, decompress it
        print_status "File is compressed, decompressing..."
        if ! gunzip -c "$temp_downloaded" > "$temp_decompressed" 2>/dev/null; then
            print_error "Failed to decompress document"
            rm -rf "$temp_dir"
            exit 1
        fi
        print_success "Decompressed successfully"
    else
        # File is already decompressed (AWS CLI auto-decompressed it)
        print_status "File is already decompressed (AWS CLI handled it automatically)"
        cp "$temp_downloaded" "$temp_decompressed"
    fi
    
    # Custom metadata already extracted above
    
    # Build metadata arguments for upload
    # We'll use a JSON file for metadata to preserve special characters
    local metadata_json_file=""
    if [[ "$custom_metadata" != "{}" && "$custom_metadata" != "null" ]]; then
        metadata_json_file="$temp_dir/metadata.json"
        echo "$custom_metadata" > "$metadata_json_file"
        print_status "Preserving metadata using JSON file"
    fi
    
    # Use the same document path (overwrite the original)
    local new_document_path="$document_path"
    
    print_status "Will overwrite original document at: $new_document_path"
    
    # Upload the decompressed document with original metadata (but without content-encoding)
    print_status "Uploading fixed document..."
    
    # Execute upload with metadata
    if [[ -n "$metadata_json_file" ]]; then
        upload_result=$(aws s3api put-object \
            --bucket "$bucket_name" \
            --key "$new_document_path" \
            --body "$temp_decompressed" \
            --content-type "$content_type" \
            --metadata "file://$metadata_json_file" \
            --endpoint-url "$AWS_ENDPOINT_URL" 2>&1)
    else
        upload_result=$(aws s3api put-object \
            --bucket "$bucket_name" \
            --key "$new_document_path" \
            --body "$temp_decompressed" \
            --content-type "$content_type" \
            --endpoint-url "$AWS_ENDPOINT_URL" 2>&1)
    fi
    
    # Check upload result
    if [[ $? -eq 0 ]]; then
        print_success "Upload successful!"
    else
        print_error "Failed to upload document"
        echo "Error details: $upload_result"
        rm -rf "$temp_dir"
        exit 1
    fi
    
    # Clean up temporary files
    rm -rf "$temp_dir"
    
    # Verify the new document
    print_status "Verifying uploaded document..."
    local new_metadata_json=$(aws s3api head-object --bucket "$bucket_name" --key "$new_document_path" --endpoint-url "$AWS_ENDPOINT_URL" --output json)
    local new_content_encoding=$(echo "$new_metadata_json" | jq -r '.ContentEncoding // "None"')
    local new_content_type=$(echo "$new_metadata_json" | jq -r '.ContentType')
    
    echo ""
    echo "=== Verification ==="
    echo "Document: s3://$bucket_name/$new_document_path"
    echo "Content-Type: $new_content_type"
    echo "Content-Encoding: $new_content_encoding"
    echo ""
    
    # Compare metadata
    print_status "Comparing metadata..."
    local old_custom_metadata=$(echo "$metadata_json" | jq -r '.Metadata // {}' | jq -S)
    local new_custom_metadata=$(echo "$new_metadata_json" | jq -r '.Metadata // {}' | jq -S)
    
    if [[ "$old_custom_metadata" == "$new_custom_metadata" ]]; then
        print_success "Custom metadata preserved successfully"
    else
        print_warning "Custom metadata may have changed"
        echo "Original metadata:"
        echo "$old_custom_metadata"
        echo ""
        echo "New metadata:"
        echo "$new_custom_metadata"
    fi
    
    if [[ "$new_content_encoding" == "None" || "$new_content_encoding" == "null" ]]; then
        print_success "Content-Encoding successfully removed"
    else
        print_warning "Content-Encoding still present: $new_content_encoding"
    fi
    
    print_success "Document encoding fix completed!"
    echo ""
    echo "Document: s3://$bucket_name/$document_path"
    echo "Status:   Gzip encoding removed, file overwritten"
}

# Main script execution
main() {
    # Check arguments
    if [[ $# -lt 1 ]]; then
        print_error "Insufficient arguments"
        show_usage
        exit 1
    fi
    
    # Get script directory
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    
    local document_path="$1"
    local bucket_name="${2:-aem-content}"  # Default to aem-content if not specified
    
    # Remove leading slash if present and convert to lowercase
    document_path="${document_path#/}"
    document_path=$(echo "$document_path" | tr '[:upper:]' '[:lower:]')
    
    print_status "Starting S3 document encoding fixer"
    print_status "Bucket: $bucket_name"
    print_status "Document path: $document_path (converted to lowercase)"
    echo ""
    
    # Check prerequisites
    check_aws_cli
    check_jq
    
    # Load environment variables
    load_env_vars
    
    # Configure AWS CLI
    configure_aws
    
    # Fix the document encoding
    fix_document_encoding "$bucket_name" "$document_path"
    
    print_success "Script completed successfully"
}

# Handle help flag
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

# Run main function with all arguments
main "$@"
