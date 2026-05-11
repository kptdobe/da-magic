#!/bin/bash

# Thin wrapper — delegates to traverse/delete-s3-folder.js for fast parallel sharded listing.
# By default, dry-run mode. Use -x to actually delete.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/delete-s3-folder.js" "$@"
