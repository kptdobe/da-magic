#!/bin/bash

# Analyze files.csv and generate statistics report
# Usage: ./analyze.sh [csv-file]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Function to print colored output
print_header() {
    echo -e "${BOLD}${BLUE}$1${NC}"
}

print_info() {
    echo -e "${CYAN}$1${NC}"
}

print_stat() {
    echo -e "  ${GREEN}$1${NC}"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to convert bytes to human-readable format
human_readable_size() {
    local bytes=$1
    
    if [[ -z "$bytes" ]] || [[ "$bytes" -eq 0 ]]; then
        echo "0 B"
        return
    fi
    
    local units=("B" "KB" "MB" "GB" "TB" "PB")
    local unit=0
    local size=$bytes
    
    while [[ $(echo "$size >= 1024" | bc) -eq 1 ]] && [[ $unit -lt 5 ]]; do
        size=$(echo "scale=2; $size / 1024" | bc)
        ((unit++))
    done
    
    echo "$size ${units[$unit]}"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [csv-file]"
    echo ""
    echo "Arguments:"
    echo "  csv-file   Path to CSV file (default: files.csv)"
    echo ""
    echo "Description:"
    echo "  Analyzes files.csv and generates a statistics report including:"
    echo "  - Total files and size"
    echo "  - Files in .trash folders"
    echo "  - Files in .da-versions folders"
    echo "  - Empty files in .da-versions"
    echo "  - Files in drafts folders"
    echo ""
    echo "Examples:"
    echo "  $0"
    echo "  $0 files.csv"
    echo "  $0 ../encoding/files.csv"
}

# Handle help flag
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

# Get CSV file
CSV_FILE="${1:-files.csv}"

# Check if file exists
if [[ ! -f "$CSV_FILE" ]]; then
    print_error "CSV file not found: $CSV_FILE"
    exit 1
fi

# Check if bc is installed (for calculations)
if ! command -v bc &> /dev/null; then
    print_error "bc command not found. Please install it:"
    echo "  macOS: brew install bc"
    echo "  Ubuntu/Debian: sudo apt-get install bc"
    exit 1
fi

print_header "================================================================"
print_header "CSV File Analysis Report"
print_header "================================================================"
echo ""
print_info "Analyzing: $CSV_FILE"
echo ""

# Count total lines (excluding header)
TOTAL_LINES=$(tail -n +2 "$CSV_FILE" | wc -l | tr -d ' ')
print_info "Total lines in CSV: $(printf "%'d" $TOTAL_LINES)"
echo ""

print_info "Processing... (this may take a while for large files)"
echo ""

START_TIME=$(date +%s)

# Process the CSV file once and collect all stats
# Format: FilePath,ContentLength,LastModified
# Skip header and process data
tail -n +2 "$CSV_FILE" | awk -F',' '
BEGIN {
    total_count = 0
    total_size = 0
    trash_count = 0
    trash_size = 0
    versions_count = 0
    versions_size = 0
    versions_zero_count = 0
    drafts_count = 0
    drafts_size = 0
}
{
    # Extract file path and size
    # Handle quoted fields
    filepath = $1
    gsub(/^"|"$/, "", filepath)  # Remove surrounding quotes
    
    size = $2
    
    # Increment totals
    total_count++
    total_size += size
    
    # Check for .trash
    if (index(filepath, "/.trash/") > 0) {
        trash_count++
        trash_size += size
    }
    
    # Check for .da-versions
    if (index(filepath, "/.da-versions/") > 0) {
        versions_count++
        versions_size += size
        
        # Check for zero size
        if (size == 0) {
            versions_zero_count++
        }
    }
    
    # Check for drafts (case-insensitive: /drafts/ or /Drafts/)
    if (tolower(filepath) ~ /\/drafts\//) {
        drafts_count++
        drafts_size += size
    }
}
END {
    print total_count "," total_size
    print trash_count "," trash_size
    print versions_count "," versions_size
    print versions_zero_count
    print drafts_count "," drafts_size
}
' > /tmp/analyze_stats_$$.txt

# Read the results
TOTAL_COUNT=$(sed -n '1p' /tmp/analyze_stats_$$.txt | cut -d',' -f1)
TOTAL_SIZE=$(sed -n '1p' /tmp/analyze_stats_$$.txt | cut -d',' -f2)
TRASH_COUNT=$(sed -n '2p' /tmp/analyze_stats_$$.txt | cut -d',' -f1)
TRASH_SIZE=$(sed -n '2p' /tmp/analyze_stats_$$.txt | cut -d',' -f2)
VERSIONS_COUNT=$(sed -n '3p' /tmp/analyze_stats_$$.txt | cut -d',' -f1)
VERSIONS_SIZE=$(sed -n '3p' /tmp/analyze_stats_$$.txt | cut -d',' -f2)
VERSIONS_ZERO_COUNT=$(sed -n '4p' /tmp/analyze_stats_$$.txt)
DRAFTS_COUNT=$(sed -n '5p' /tmp/analyze_stats_$$.txt | cut -d',' -f1)
DRAFTS_SIZE=$(sed -n '5p' /tmp/analyze_stats_$$.txt | cut -d',' -f2)

# Clean up temp file
rm -f /tmp/analyze_stats_$$.txt

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Convert sizes to human-readable format
TOTAL_SIZE_HR=$(human_readable_size $TOTAL_SIZE)
TRASH_SIZE_HR=$(human_readable_size $TRASH_SIZE)
VERSIONS_SIZE_HR=$(human_readable_size $VERSIONS_SIZE)
DRAFTS_SIZE_HR=$(human_readable_size $DRAFTS_SIZE)

# Calculate percentages
if [[ $TOTAL_COUNT -gt 0 ]]; then
    TRASH_PERCENT=$(echo "scale=2; ($TRASH_COUNT * 100) / $TOTAL_COUNT" | bc)
    VERSIONS_PERCENT=$(echo "scale=2; ($VERSIONS_COUNT * 100) / $TOTAL_COUNT" | bc)
    DRAFTS_PERCENT=$(echo "scale=2; ($DRAFTS_COUNT * 100) / $TOTAL_COUNT" | bc)
else
    TRASH_PERCENT=0
    VERSIONS_PERCENT=0
    DRAFTS_PERCENT=0
fi

if [[ $TOTAL_SIZE -gt 0 ]]; then
    TRASH_SIZE_PERCENT=$(echo "scale=2; ($TRASH_SIZE * 100) / $TOTAL_SIZE" | bc)
    VERSIONS_SIZE_PERCENT=$(echo "scale=2; ($VERSIONS_SIZE * 100) / $TOTAL_SIZE" | bc)
    DRAFTS_SIZE_PERCENT=$(echo "scale=2; ($DRAFTS_SIZE * 100) / $TOTAL_SIZE" | bc)
else
    TRASH_SIZE_PERCENT=0
    VERSIONS_SIZE_PERCENT=0
    DRAFTS_SIZE_PERCENT=0
fi

# Display results
print_header "RESULTS"
print_header "================================================================"
echo ""

# Total stats
print_header "📊 TOTAL"
print_stat "Files:          $(printf "%'d" $TOTAL_COUNT)"
print_stat "Total Size:     $TOTAL_SIZE_HR ($(printf "%'d" $TOTAL_SIZE) bytes)"
echo ""

# Trash stats
print_header "🗑️  .trash FOLDERS"
print_stat "Files:          $(printf "%'d" $TRASH_COUNT) (${TRASH_PERCENT}% of total)"
print_stat "Total Size:     $TRASH_SIZE_HR ($(printf "%'d" $TRASH_SIZE) bytes)"
print_stat "Size %:         ${TRASH_SIZE_PERCENT}% of total storage"
echo ""

# Versions stats
print_header "📦 .da-versions FOLDERS"
print_stat "Files:          $(printf "%'d" $VERSIONS_COUNT) (${VERSIONS_PERCENT}% of total)"
print_stat "Total Size:     $VERSIONS_SIZE_HR ($(printf "%'d" $VERSIONS_SIZE) bytes)"
print_stat "Size %:         ${VERSIONS_SIZE_PERCENT}% of total storage"
print_stat "Empty files:    $(printf "%'d" $VERSIONS_ZERO_COUNT)"
if [[ $VERSIONS_COUNT -gt 0 ]]; then
    VERSIONS_ZERO_PERCENT=$(echo "scale=2; ($VERSIONS_ZERO_COUNT * 100) / $VERSIONS_COUNT" | bc)
    print_stat "Empty %:        ${VERSIONS_ZERO_PERCENT}% of version files"
fi
echo ""

# Drafts stats
print_header "📝 DRAFTS FOLDERS"
print_stat "Files:          $(printf "%'d" $DRAFTS_COUNT) (${DRAFTS_PERCENT}% of total)"
print_stat "Total Size:     $DRAFTS_SIZE_HR ($(printf "%'d" $DRAFTS_SIZE) bytes)"
print_stat "Size %:         ${DRAFTS_SIZE_PERCENT}% of total storage"
echo ""

# Processing time
print_header "⏱️  PERFORMANCE"
print_stat "Processing time: ${DURATION}s"
if [[ $DURATION -gt 0 ]]; then
    ROWS_PER_SEC=$((TOTAL_COUNT / DURATION))
    print_stat "Throughput:      $(printf "%'d" $ROWS_PER_SEC) rows/second"
fi
echo ""

print_header "================================================================"
echo ""

# Summary recommendations
if [[ $TRASH_COUNT -gt 0 ]]; then
    echo -e "${YELLOW}💡 Tip: You have $(printf "%'d" $TRASH_COUNT) files in .trash folders using $TRASH_SIZE_HR${NC}"
    echo -e "${YELLOW}   Consider cleaning up if no longer needed.${NC}"
    echo ""
fi

if [[ $VERSIONS_ZERO_COUNT -gt 0 ]]; then
    echo -e "${YELLOW}💡 Tip: You have $(printf "%'d" $VERSIONS_ZERO_COUNT) empty files in .da-versions folders${NC}"
    echo -e "${YELLOW}   These might be placeholder files or corrupted versions.${NC}"
    echo ""
fi

