#!/bin/bash
# Delegates to traverse/list-folder.js which uses sharding for parallel S3 listings.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/traverse/list-folder.js" "$@"
