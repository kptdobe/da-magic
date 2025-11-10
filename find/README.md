# Find and Replace Scripts

This folder contains scripts to find and replace HLX references in S3 HTML documents.

## Scripts

### 1. `find-hlx-ref.sh`

Finds all HTML documents containing URLs with `.hlx.page` or `.hlx.live` domains.

**Usage:**
```bash
./find-hlx-ref.sh <prefix>

# Examples:
./find-hlx-ref.sh adobecom/da-bacom
./find-hlx-ref.sh kptdobe/daplayground
```

**Output:**
- Console: Shows each file being checked and URLs found
- `hlx-references.txt`: Tab-delimited file with columns: File Path | Type | URL

**Features:**
- Scans recursively through all HTML files
- Extracts full URLs (including paths)
- Automatically ignores `.da-versions` and `.trash` folders
- High concurrency for fast scanning
- Memory optimized for large trees

---

### 2. `extract-files.sh`

Extracts unique file paths from the first column of the references file.

**Usage:**
```bash
./extract-files.sh [input-file] [output-file]

# Examples:
./extract-files.sh                                    # Default: hlx-references.txt -> files.txt
./extract-files.sh hlx-references-bacom.txt files-bacom.txt
```

**Output:**
- Text file with unique file paths (one per line)
- Sorted alphabetically

---

### 3. `replace-hlx-with-aem.sh`

Replaces `.hlx.page` with `.aem.page` and `.hlx.live` with `.aem.live` in S3 files.

**Usage:**
```bash
./replace-hlx-with-aem.sh [OPTIONS] <file-list>

# Options:
#   -b, --bucket <bucket>    S3 bucket name (default: aem-content)
#   --batch-size <size>      Number of files to process in parallel (default: 20)
#   -h, --help               Show help message

# Examples:
./replace-hlx-with-aem.sh list.txt
./replace-hlx-with-aem.sh files-bacom.txt
./replace-hlx-with-aem.sh -b my-bucket custom-list.txt
./replace-hlx-with-aem.sh --batch-size 30 files.txt  # Faster with more parallel processes
```

**What it does:**
1. Reads file paths from the input text file (one per line)
2. Downloads each file to `.cache/` folder (preserved for reuse)
3. **Saves metadata** to `.metadata.json` files alongside cached files
4. Creates `.backup` files before modification
5. Replaces all occurrences of:
   - `.hlx.page` → `.aem.page`
   - `.hlx.live` → `.aem.live`
6. Uploads the modified file back to S3
7. **Preserves ALL metadata** (Content-Type, custom metadata, etc.)

**Features:**
- **Parallel batch processing**: Processes 20 files simultaneously (configurable)
- Uses `.cache` folder to avoid re-downloading files
- Caches metadata for full restoration capability
- Creates backup files before modification
- Preserves all S3 metadata (Content-Type, custom headers)
- Shows progress for each file
- Summary statistics at the end
- Skips files without HLX references

**Performance:**
- Default: 20 files processed in parallel per batch
- Adjustable with `--batch-size` option
- Significantly faster than sequential processing
- Suitable for processing thousands of files

**Cache Structure:**
```
.cache/
  path/to/file.html              # Modified file
  path/to/file.html.backup       # Original file (before modification)
  path/to/file.html.metadata.json  # Complete metadata from S3
```

---

### 4. `restore-from-cache.sh`

Restores files from `.cache` back to S3 with their original metadata. Useful for rollback if something goes wrong.

**Usage:**
```bash
./restore-from-cache.sh [OPTIONS] <file-list>

# Options:
#   -b, --bucket <bucket>  S3 bucket name (default: aem-content)
#   --use-backup           Restore from .backup files (original, unmodified)
#   -h, --help             Show help message

# Examples:
./restore-from-cache.sh list.txt                # Restore modified files
./restore-from-cache.sh --use-backup list.txt   # Restore original backups
./restore-from-cache.sh -b my-bucket files.txt
```

**What it does:**
1. Reads file paths from the input text file
2. Loads files from `.cache/` directory
3. Loads metadata from `.metadata.json` files
4. Uploads files back to S3 with original metadata
5. Can restore either modified files or original `.backup` files

**Use Cases:**
- **Rollback**: Restore original files if replacement went wrong
- **Re-upload**: Re-upload modified files if S3 had issues
- **Recovery**: Restore from cache after accidental deletion

---

## Typical Workflow

### Normal Workflow (with safety checks)

```bash
# Step 1: Find all HTML files with HLX references
./find-hlx-ref.sh adobecom/da-bacom

# Step 2: Extract unique file paths
./extract-files.sh hlx-references.txt files-bacom.txt

# Step 3: Review the files (optional but recommended)
head -20 files-bacom.txt
wc -l files-bacom.txt

# Step 4: Test on a small subset first (recommended)
head -10 files-bacom.txt > test-files.txt
./replace-hlx-with-aem.sh test-files.txt

# Step 5: Verify the test files in S3 (check manually)
# If all looks good, proceed with full list

# Step 6: Replace HLX with AEM references for all files
./replace-hlx-with-aem.sh files-bacom.txt
```

### Rollback Workflow (if something went wrong)

```bash
# Restore original unmodified files from .backup
./restore-from-cache.sh --use-backup files-bacom.txt

# Or restore the modified files (if S3 upload had issues)
./restore-from-cache.sh files-bacom.txt
```

## Environment Variables

All scripts require these environment variables in `.dev.vars` file (in project root):
```
S3_ACCESS_KEY_ID=your_access_key
S3_SECRET_ACCESS_KEY=your_secret_key
S3_DEF_URL=https://your-s3-endpoint.com
```

## Requirements

- Node.js (for find-hlx-ref.js)
- AWS CLI (for replace-hlx-with-aem.sh)
- Bash shell
- npm dependencies (run `npm install` in this folder)

## Cache Structure and Safety

The `.cache/` directory preserves complete backups with metadata:

```
.cache/
├── path/to/file1.html              # Modified file (with .aem replacements)
├── path/to/file1.html.backup       # Original file (unmodified)
├── path/to/file1.html.metadata.json  # Complete S3 metadata
├── path/to/file2.html
├── path/to/file2.html.backup
└── path/to/file2.html.metadata.json
```

**Safety Features:**
- ✅ Original files preserved as `.backup`
- ✅ Complete metadata saved as `.metadata.json`
- ✅ Cache reused on subsequent runs (no re-download)
- ✅ Full restoration capability with `restore-from-cache.sh`
- ✅ Can rollback to original or re-upload modified files

**Important:**
- Never delete `.cache/` folder - it's your backup!
- Test on small subsets before processing large batches
- Verify changes in S3 before proceeding with more files

## Notes

- `.cache/` folder is created and preserved by `replace-hlx-with-aem.sh`
- `.da-versions/` and `.trash/` folders are automatically ignored
- All scripts support `--help` flag for usage information
- Metadata is fully preserved during replacement
- Backup files allow complete rollback if needed

