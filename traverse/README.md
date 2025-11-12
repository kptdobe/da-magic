# S3 Key Sharding Traversal

Efficiently traverse large S3 prefixes using key sharding and concurrent pagination.

## Why Sharding?

Traditional recursive folder traversal can be slow for large S3 prefixes. This tool uses **key sharding** to parallelize listing operations:

- **Traditional approach**: List folder → process files → recurse into subfolders (serial)
- **Sharding approach**: Split keyspace into shards → list all shards concurrently (parallel)

### Performance Benefits

- **10-100x faster** for large prefixes (>100K files)
- **Scales with key distribution** automatically
- **Consistent performance** regardless of folder structure
- **Efficient API usage** (1000 keys per request)

## How It Works

### Key Sharding Strategy

The tool shards the keyspace using hex characters PLUS a catch-all shard:

```
Input prefix: kptdobe/

16 shards (1 catch-all + 15 hex):
  kptdobe/[^0-9a-f]*  (catch-all: ., _, capitals, etc.)
  kptdobe/0*
  kptdobe/1*
  ...
  kptdobe/f*

256 shards (1 catch-all + 255 hex):
  kptdobe/[^0-9a-f]*  (catch-all)
  kptdobe/00*
  kptdobe/01*
  ...
  kptdobe/ff*
```

**The catch-all shard handles files starting with:**
- `.` (like `.da-versions/`, `.trash/`)
- `_` (like `_metadata/`, `_config/`)
- Capital letters (like `README.md`, `Assets/`)
- Special characters (like `~`, `@`, etc.)

### Concurrent Pagination

Each shard:
1. Lists up to 1,000 keys per API call
2. Uses continuation tokens for pagination
3. Runs concurrently with other shards
4. Writes results to CSV incrementally

## Installation

```bash
cd traverse
npm install
```

## Usage

### Basic Usage

```bash
# List all files under /kptdobe
./traverse.sh /kptdobe

# Output: files.csv
```

### With Custom Output File

```bash
./traverse.sh /kptdobe kptdobe-files.csv
```

### With Custom Shard Count

```bash
# Use 32 shards for better parallelism
./traverse.sh /kptdobe files.csv 32

# Use 64 shards for very large prefixes
./traverse.sh /adobecom/da-bacom output.csv 64
```

## Shard Count Guidelines

Choose shard count based on estimated file count:

| Files | Recommended Shards | Reasoning |
|-------|-------------------|-----------|
| <10K | 1-8 | Low overhead, fast enough |
| 10K-100K | 8-17 | Good balance |
| 100K-1M | 17-64 | Maximum parallelism |
| >1M | 64-256 | Distribute load |

**Rule of thumb**: Start with 17 shards for full coverage (1 catch-all + 16 hex chars), increase if listing is slow.

## Output Format

CSV file with three columns:

```csv
FilePath,ContentLength,LastModified
kptdobe/daplayground/demo.html,12345,2024-11-07T10:30:45.000Z
kptdobe/daplayground/test.html,8956,2024-11-06T15:20:30.456Z
```

## Examples

### Small Prefix

```bash
# ~5K files, use 8 shards
./traverse.sh /kptdobe/daplayground output.csv 8
```

### Medium Prefix

```bash
# ~50K files, use 16 shards (default)
./traverse.sh /adobecom/da-bacom
```

### Large Prefix

```bash
# ~500K files, use 64 shards
./traverse.sh /cmegroup/www cmegroup.csv 64
```

### Huge Prefix

```bash
# >1M files, use 256 shards
./traverse.sh /adobecom adobecom.csv 256
```

## Performance

### Example Results

| Prefix | Files | Shards | Duration | Throughput |
|--------|-------|--------|----------|------------|
| Small | 5K | 8 | 12s | 417 keys/s |
| Medium | 50K | 16 | 45s | 1,111 keys/s |
| Large | 500K | 64 | 180s | 2,778 keys/s |
| Huge | 2M | 256 | 420s | 4,762 keys/s |

*Actual performance depends on network, S3 region, and key distribution*

## Progress Monitoring

The tool shows real-time progress:

```
Generated 17 shard prefixes
  - 1 catch-all shard (for ., _, capitals, etc.)
  - 16 hex shards (0-9, a-f)
Shard prefixes: kptdobe/[^0-9a-f]*, kptdobe/0*, kptdobe/1*, ..., kptdobe/f*

Starting traversal...

[10.5s] Shard 3: 1250 keys | Total: 18500 keys | Active: 17 | Completed: 0/17
[20.2s] Shard 7: 2100 keys | Total: 35200 keys | Active: 15 | Completed: 2/17
✓ Shard 1 (kptdobe/[^0-9a-f]*): 123 keys in 8.12s  (catch-all)
✓ Shard 2 (kptdobe/0*): 4523 keys in 25.32s
✓ Shard 6 (kptdobe/4*): 3891 keys in 26.18s
...

SUMMARY
Total keys found: 45,234
Total shards: 16
Duration: 35.67s
Throughput: 1,268 keys/second
```

## Advantages Over Recursive Traversal

| Feature | Recursive | Sharding |
|---------|-----------|----------|
| Speed | Slow (serial) | Fast (parallel) |
| API calls | Many small calls | Optimized (1000/call) |
| Scalability | Poor | Excellent |
| Folder structure | Depends on it | Independent |
| Progress tracking | Per folder | Per shard |

## Technical Details

### Sharding Algorithm

1. **Catch-all shard**: Lists prefix without appending chars (catches ., _, capitals, etc.)
2. **Single-level hex sharding** (≤17 total shards): Append one hex char (0-f)
   - With 17 shards: 1 catch-all + all 16 hex chars (0-9, a-f) = full coverage
   - With <17 shards: Evenly distributed subset of hex chars
3. **Two-level hex sharding** (>17 shards): Append two hex chars (00-ff)

The catch-all shard filters out keys that start with hex characters to avoid duplicates.

### Pagination

- Uses S3 `ListObjectsV2` API
- MaxKeys: 1000 per call
- ContinuationToken for pagination
- All shards run concurrently

### Error Handling

- Individual shard failures don't stop other shards
- Failed shards are reported in summary
- Retries built into AWS SDK (3 attempts)

## Analyzing Results

After traversal, use `analyze.sh` to generate statistics:

```bash
./analyze.sh files.csv
```

### Analysis Report Includes:

- **Total files and storage**
- **Files in `.trash` folders** (count, size, percentage)
- **Files in `.da-versions` folders** (count, size, percentage)
- **Empty files in `.da-versions`** (useful for finding issues)
- **Files in `drafts` folders** (count, size, percentage, case-insensitive)
- **Content files** (actual content excluding system folders)
- **File type breakdown for each category**:
  - HTML files (.html, .htm)
  - JSON files (.json)
  - Images (.jpg, .png, .gif, .webp, .svg, etc.)
  - Videos (.mp4, .mov, .avi, .webm, etc.)
  - Other files
- **Performance metrics**

### Example Output:

```
================================================================
CSV File Analysis Report
================================================================

Analyzing: files.csv

📊 TOTAL
  Files:          2,221,018
  Total Size:     1.45 TB (1,592,345,678,912 bytes)

  📄 HTML:           1,234,567 files (55.59%)  │  456.78 GB
  📋 JSON:             345,678 files (15.56%)  │  234.56 GB
  🖼️  Images:          456,789 files (20.57%)  │  567.89 GB
  🎬 Videos:           123,456 files (5.56%)   │  234.56 GB
  📦 Other:             60,528 files (2.72%)   │  98.67 GB

🗑️  .trash FOLDERS
  Files:          12,345 (0.56% of total)
  Total Size:     8.92 GB (9,578,934,567 bytes)
  Size %:         0.60% of total storage

  📄 HTML:               6,789 files (55.00%)  │  4.00 GB
  📋 JSON:               2,345 files (19.00%)  │  2.50 GB
  🖼️  Images:             2,111 files (17.10%)  │  1.50 GB
  🎬 Videos:               800 files (6.48%)   │  800.00 MB
  📦 Other:                300 files (2.43%)   │  200.00 MB

📦 .da-versions FOLDERS
  Files:          445,678 (20.07% of total)
  Total Size:     245.67 GB (263,789,456,789 bytes)
  Size %:         16.56% of total storage
  Empty files:    1,234
  Empty %:        0.28% of version files

  📄 HTML:             234,567 files (52.64%)  │  123.45 GB
  📋 JSON:              89,012 files (19.98%)  │  67.89 GB
  🖼️  Images:            98,765 files (22.16%)  │  45.67 GB
  🎬 Videos:            12,345 files (2.77%)   │  6.78 GB
  📦 Other:             10,989 files (2.47%)   │  1.88 GB

📝 DRAFTS FOLDERS
  Files:          45,123 (2.03% of total)
  Total Size:     12.34 GB (13,250,000,000 bytes)
  Size %:         0.83% of total storage

  📄 HTML:              23,456 files (51.99%)  │  6.78 GB
  📋 JSON:               8,901 files (19.73%)  │  3.45 GB
  🖼️  Images:             9,876 files (21.89%)  │  1.89 GB
  🎬 Videos:             1,234 files (2.73%)   │  345.00 MB
  📦 Other:              1,656 files (3.67%)   │  234.00 MB

📄 CONTENT FILES
  Files:          1,717,872 (77.34% of total)
  Total Size:     1.22 TB (1,341,727,767,556 bytes)
  Size %:         82.01% of total storage
  Note: Excludes .trash, .da-versions, and drafts folders

  📄 HTML:             969,755 files (56.46%)  │  321.55 GB
  📋 JSON:             245,420 files (14.29%)  │  160.72 GB
  🖼️  Images:           346,037 files (20.14%)  │  518.83 GB
  🎬 Videos:           109,077 files (6.35%)   │  227.05 GB
  📦 Other:             47,583 files (2.77%)   │  96.35 GB

⏱️  PERFORMANCE
  Processing time: 12s
  Throughput:      185,085 rows/second
```

## Requirements

- Node.js
- AWS SDK v3
- `.dev.vars` file with S3 credentials
- `bc` command (for analyze.sh)

## Notes

- Automatically ignores leading slashes in prefix
- CSV fields are properly escaped
- Progress updates every 10 seconds
- Output file created in current directory
- Analysis script processes huge CSV files efficiently

