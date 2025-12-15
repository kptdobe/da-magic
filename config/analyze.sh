#!/bin/bash
# Analyze project permissions from config export
# Usage: ./analyze.sh

set -e

# Configuration
PROJECTS_FILE=".data/projects.txt"
CONFIG_FILE=".data/config-export.json"
OUTPUT_FILE="permissions-report.csv"

# Check if files exist
if [[ ! -f "$PROJECTS_FILE" ]]; then
    echo "Error: Projects file not found: $PROJECTS_FILE"
    exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "Error: Config file not found: $CONFIG_FILE"
    exit 1
fi

echo "Analyzing permissions for projects..."
echo "Projects source: $PROJECTS_FILE"
echo "Config source:   $CONFIG_FILE"
echo "Output:          $OUTPUT_FILE"
echo ""

# Create CSV header
echo "Project,HasPermissions" > "$OUTPUT_FILE"

# Process with Node.js for reliable JSON handling
node -e '
const fs = require("fs");

try {
  // Load files
  const projects = fs.readFileSync(process.argv[1], "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);
    
  const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  
  // Create a map of project configs for faster lookup
  const configMap = new Map();
  if (config.data && Array.isArray(config.data)) {
    config.data.forEach(item => {
      configMap.set(item.key, item.value);
    });
  }
  
  // Analyze each project
  let hasPermsCount = 0;
  let noPermsCount = 0;
  const results = [];
  
  projects.forEach(project => {
    const projectConfig = configMap.get(project);
    let hasPermissions = false;
    
    // Check if permissions sheet exists
    if (projectConfig && projectConfig.permissions) {
      hasPermissions = true;
    }
    
    if (hasPermissions) {
      hasPermsCount++;
    } else {
      noPermsCount++;
    }
    
    results.push(`${project},${hasPermissions}`);
  });
  
  // Append results to output file
  fs.appendFileSync(process.argv[3], results.join("\n") + "\n");
  
  console.log(`Total projects analyzed: ${projects.length}`);
  console.log(`Projects with permissions: ${hasPermsCount}`);
  console.log(`Projects without permissions: ${noPermsCount}`);
  
} catch (error) {
  console.error("Error processing files:", error.message);
  process.exit(1);
}
' "$PROJECTS_FILE" "$CONFIG_FILE" "$OUTPUT_FILE"

echo ""
echo "Report generated: $OUTPUT_FILE"

