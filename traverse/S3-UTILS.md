# S3 Utilities Module

Shared code between `traverse.js` and `find-hlx-ref.js` for S3 operations.

## Shared Functions

### 1. `loadEnvVars()`
Loads environment variables from `.dev.vars` file.
- Tries multiple possible paths
- Parses key=value format
- Returns object with env vars

### 2. `createS3Client(envVars)`
Creates configured S3 client with:
- Credentials from env vars
- Custom endpoint
- **100 max sockets** (for 63 concurrent shards)
- Connection keep-alive for performance
- Retry logic (3 attempts)

### 3. `listShardObjects(s3Client, bucket, shard, basePrefix, onBatch)`
Lists all objects in a shard with pagination:
- Handles continuation tokens
- Filters objects by shard to avoid duplicates
- Calls batch processor for each page
- Returns total object count

### 4. `processShards(options)`
High-level shard processing with:
- Parallel shard execution
- Progress tracking
- Statistics collection
- Customizable object processing
- Progress and completion callbacks

### 5. `formatShardLabel(shard)`
Formats shard for display:
- Catch-all: `prefix/[^0-9a-zA-Z]*`
- Alphanum: `prefix/a*`

### 6. `displayShardInfo(shards)`
Displays shard configuration summary

## Usage in traverse.js

```javascript
const { 
  loadEnvVars, 
  createS3Client, 
  processShards,
  displayShardInfo 
} = require('./s3-utils.js');

const envVars = loadEnvVars();
const s3Client = createS3Client(envVars);

// Display info
displayShardInfo(shards);

// Process all shards
await processShards({
  s3Client,
  bucket,
  prefix,
  processObject: (obj) => {
    // Write to CSV
  },
  onProgress: (stats) => {
    console.log(`Progress: ${stats.totalObjects} objects`);
  },
  onShardComplete: (result) => {
    console.log(`✓ Shard ${result.shardId} complete`);
  }
});
```

## Usage in find-hlx-ref.js

```javascript
// Same imports, but custom processObject to search HTML/JSON
processObject: async (obj) => {
  if (isHtmlOrJson(obj.Key)) {
    const content = await downloadFile(obj.Key);
    searchForHlxRefs(content);
  }
}
```

## Benefits

1. **DRY** - No duplicated code
2. **Consistent** - Same S3 configuration everywhere
3. **Tested** - Sharding logic is tested
4. **Maintainable** - Fix bugs in one place
5. **Performant** - Optimized socket pooling

## What's NOT Shared

Each script still has its own:
- Command-line argument parsing
- Output formatting
- Domain-specific logic (CSV writing vs HLX searching)

