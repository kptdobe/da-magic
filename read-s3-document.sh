#!/bin/bash

# S3 Document Reader Script
# Usage: ./read-s3-document.sh <document-path> [bucket-name]
# Note: bucket-name defaults to "aem-content" if not specified

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
    echo "  $0 documents/report.pdf"
    echo "  $0 folder/file.txt"
    echo "  $0 config/settings.json aem-content"
    echo ""
    echo "The script will read the document and display its contents or save it locally."
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

# Function to read document from S3
read_s3_document() {
    local bucket_name="$1"
    local document_path="$2"
    
    print_status "Reading document: s3://$bucket_name/$document_path"
    
    # Check if the object exists
    if aws s3api head-object --bucket "$bucket_name" --key "$document_path" --endpoint-url "$AWS_ENDPOINT_URL" &> /dev/null; then
        print_success "Document exists"
        
        # Get object metadata
        print_status "Getting document metadata..."
        echo ""
        echo "=== Document Metadata ==="
        aws s3api head-object --bucket "$bucket_name" --key "$document_path" --endpoint-url "$AWS_ENDPOINT_URL" --output json
        echo ""
        echo "=== End of Metadata ==="
        
        # Determine if we should display or download based on content type
        local content_type=$(aws s3api head-object --bucket "$bucket_name" --key "$document_path" --endpoint-url "$AWS_ENDPOINT_URL" --query 'ContentType' --output text)
        local content_encoding=$(aws s3api head-object --bucket "$bucket_name" --key "$document_path" --endpoint-url "$AWS_ENDPOINT_URL" --query 'ContentEncoding' --output text 2>/dev/null || echo "None")

        print_status "Content type: $content_type"
        print_status "Content encoding: $content_encoding"
        
        if [[ "$content_type" == text/* ]] || [[ "$content_type" == application/json ]] || [[ "$content_type" == application/xml ]]; then
            print_status "Displaying text content..."
            
            # Check if content is gzip-encoded
            if [[ "$content_encoding" == "gzip" ]]; then
                print_status "Content is gzip-encoded, decompressing..."
                echo ""
                echo "=== Document Content ==="
                # Use get-object instead of cp for better control
                aws s3api get-object --bucket "$bucket_name" --key "$document_path" --endpoint-url "$AWS_ENDPOINT_URL" /dev/stdout 2>/dev/null | gunzip
                echo ""
                echo "=== End of Document ==="
            else
                echo ""
                echo "=== Document Content ==="
                # Try aws s3 cp first, fall back to get-object if it fails
                if ! aws s3 cp "s3://$bucket_name/$document_path" - --endpoint-url "$AWS_ENDPOINT_URL" 2>/dev/null; then
                    # Fallback: try with get-object and check if it's gzip
                    print_warning "Standard download failed, trying alternative method..."
                    local temp_file=$(mktemp)
                    aws s3api get-object --bucket "$bucket_name" --key "$document_path" --endpoint-url "$AWS_ENDPOINT_URL" "$temp_file" >/dev/null 2>&1
                    
                    # Check if the file is gzip compressed by trying to decompress
                    if gunzip -t "$temp_file" 2>/dev/null; then
                        print_status "File appears to be gzip-compressed, decompressing..."
                        gunzip -c "$temp_file"
                    else
                        cat "$temp_file"
                    fi
                    rm -f "$temp_file"
                fi
                echo ""
                echo "=== End of Document ==="
            fi
        else
            # For binary files, just display info and continue
            local filename=$(basename "$document_path")
            print_warning "Binary file detected (Content-Type: $content_type)"
            print_status "File: $filename (binary content not displayed)"
        fi
        
    else
        print_error "Document not found: s3://$bucket_name/$document_path"
        exit 1
    fi
}

# Function to list bucket contents (optional feature)
list_bucket_contents() {
    local bucket_name="$1"
    local prefix="${2:-}"
    
    print_status "Listing contents of bucket: $bucket_name"
    if [[ -n "$prefix" ]]; then
        print_status "With prefix: $prefix"
    fi
    
    aws s3 ls "s3://$bucket_name/$prefix" --recursive --endpoint-url "$AWS_ENDPOINT_URL" --human-readable
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
    
    print_status "Starting S3 document reader"
    print_status "Bucket: $bucket_name"
    print_status "Document path: $document_path (converted to lowercase)"
    echo ""
    
    # Check prerequisites
    check_aws_cli
    
    # Load environment variables
    load_env_vars
    
    # Configure AWS CLI
    configure_aws
    
    # Read the document
    read_s3_document "$bucket_name" "$document_path"
    
    print_success "Script completed successfully"
}

# Handle help flag
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

# Run main function with all arguments
main "$@"
