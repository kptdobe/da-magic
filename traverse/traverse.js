#!/usr/bin/env node
// Efficiently traverse S3 bucket using key sharding and concurrent pagination
// Usage: node traverse.js <prefix> [output-file] [shard-count]
// Example: node traverse.js /kptdobe files.csv 16

const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
const fs = require('fs');
const {
  loadEnvVars,
  createS3Client,
  generateShardPrefixes,
  filterObjectsByShard,
  listShardObjects,
  displayShardInfo,
  formatShardLabel
} = require('./s3-utils.js');

// Parse command line arguments
if (process.argv.length < 3) {
  console.error('Usage: node traverse.js <prefix> [output-file]');
  console.error('Example: node traverse.js /kptdobe files.csv');
  console.error('Example: node traverse.js kptdobe/daplayground output.csv');
  console.error('');
  console.error('Arguments:');
  console.error('  prefix       - Path prefix to traverse (e.g., /kptdobe or kptdobe/subfolder)');
  console.error('  output-file  - CSV output file (default: files.csv)');
  console.error('');
  console.error('Note: Always uses 63 concurrent shards for complete coverage');
  console.error('      (1 catch-all + 62 alphanumeric: 0-9, A-Z, a-z)');
  process.exit(1);
}

const bucket = 'aem-content';
let prefix = process.argv[2];

// Remove leading slash if present
if (prefix.startsWith('/')) {
  prefix = prefix.substring(1);
}

const outputFile = process.argv[3] || 'files.csv';
// Note: shardCount parameter is kept for API compatibility but always uses 63 internally  
const shardCount = 63; // Always use 63 for complete coverage (1 catch-all + 62 alphanumeric)

// Initialize S3 client
const envVars = loadEnvVars();
const s3Client = createS3Client(envVars);

// Statistics
const stats = {
  totalKeys: 0,
  totalShards: 0,
  completedShards: 0,
  activeShards: 0,
  startTime: Date.now(),
  lastUpdate: Date.now()
};

// Create output stream
let outputStream = null;

// List all keys in a shard with pagination
async function listShard(shard, shardId) {
  stats.totalShards++;
  stats.activeShards++;
  
  let continuationToken = null;
  let shardKeyCount = 0;
  const startTime = Date.now();
  const shardPrefix = shard.prefix;
  const isCatchAll = shard.type === 'catch-all';
  
  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: shardPrefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken
      });
      
      const response = await s3Client.send(command);
      
      if (response.Contents && response.Contents.length > 0) {
        // Filter keys for this shard to avoid duplicates
        const keysToProcess = filterObjectsByShard(response.Contents, shard, prefix);
        
        shardKeyCount += keysToProcess.length;
        stats.totalKeys += keysToProcess.length;
        
        // Write to CSV
        for (const obj of keysToProcess) {
          const key = obj.Key || '';
          const size = obj.Size || 0;
          const lastModified = obj.LastModified ? obj.LastModified.toISOString() : '';
          
          // Escape CSV fields
          const escapedKey = key.includes(',') || key.includes('"') ? `"${key.replace(/"/g, '""')}"` : key;
          outputStream.write(`${escapedKey},${size},${lastModified}\n`);
        }
      }
      
      continuationToken = response.NextContinuationToken;
      
      // Progress update every 10 seconds
      if (Date.now() - stats.lastUpdate > 10000) {
        const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
        console.log(`[${elapsed}s] Shard ${shardId}: ${shardKeyCount} keys | Total: ${stats.totalKeys} keys | Active: ${stats.activeShards} | Completed: ${stats.completedShards}/${stats.totalShards}`);
        stats.lastUpdate = Date.now();
      }
      
    } while (continuationToken);
    
    stats.completedShards++;
    stats.activeShards--;
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const shardLabel = formatShardLabel(shard);
    console.log(`✓ Shard ${shardId} (${shardLabel}): ${shardKeyCount} keys in ${duration}s`);
    
    return shardKeyCount;
    
  } catch (error) {
    stats.activeShards--;
    const shardLabel = formatShardLabel(shard);
    console.error(`✗ Shard ${shardId} (${shardLabel}) failed: ${error.message}`);
    return 0;
  }
}

// Main function
async function main() {
  console.log('='.repeat(70));
  console.log('S3 Key Sharding Traversal');
  console.log('='.repeat(70));
  console.log(`Bucket: ${bucket}`);
  console.log(`Prefix: ${prefix}`);
  console.log(`Output: ${outputFile}`);
  console.log(`Shards: 63 concurrent (complete coverage)`);
  console.log('');
  
  // Create output stream with CSV header
  outputStream = fs.createWriteStream(outputFile);
  outputStream.write('FilePath,ContentLength,LastModified\n');
  
  outputStream.on('error', (err) => {
    console.error(`Error writing to ${outputFile}:`, err.message);
  });
  
  try {
    // Generate shard prefixes
    const shards = generateShardPrefixes(prefix, shardCount);
    displayShardInfo(shards);
    
    console.log('');
    console.log('Starting traversal...');
    console.log('');
    
    stats.startTime = Date.now();
    stats.lastUpdate = Date.now();
    
    // Process all shards concurrently
    const shardPromises = shards.map((shard, index) => 
      listShard(shard, index + 1)
    );
    
    const results = await Promise.all(shardPromises);
    
    // Close output stream
    outputStream.end();
    
    // Summary
    console.log('');
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total keys found: ${stats.totalKeys.toLocaleString()}`);
    console.log(`Total shards: ${stats.totalShards}`);
    console.log(`Successful shards: ${stats.completedShards}`);
    console.log(`Failed shards: ${stats.totalShards - stats.completedShards}`);
    
    const duration = ((Date.now() - stats.startTime) / 1000).toFixed(2);
    console.log(`Duration: ${duration}s`);
    
    const keysPerSecond = (stats.totalKeys / (duration || 1)).toFixed(0);
    console.log(`Throughput: ${keysPerSecond} keys/second`);
    
    console.log('');
    console.log(`Output saved to: ${outputFile}`);
    console.log('');
    
    if (stats.totalKeys === 0) {
      console.log('⚠️  No keys found. Check your prefix and permissions.');
    } else {
      console.log('✓ Traversal complete!');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    if (outputStream) {
      outputStream.end();
    }
    process.exit(1);
  }
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

