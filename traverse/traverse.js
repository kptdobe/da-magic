#!/usr/bin/env node
// Efficiently traverse S3 bucket using key sharding and concurrent pagination
// Usage: node traverse.js <prefix> [output-file] [shard-count]
// Example: node traverse.js /kptdobe files.csv 16

const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
if (process.argv.length < 3) {
  console.error('Usage: node traverse.js <prefix> [output-file] [shard-count]');
  console.error('Example: node traverse.js /kptdobe files.csv 16');
  console.error('Example: node traverse.js kptdobe/daplayground output.csv 8');
  console.error('');
  console.error('Arguments:');
  console.error('  prefix       - Path prefix to traverse (e.g., /kptdobe or kptdobe/subfolder)');
  console.error('  output-file  - CSV output file (default: files.csv)');
  console.error('  shard-count  - Number of concurrent shards (default: 16, valid: 1-256)');
  process.exit(1);
}

const bucket = 'aem-content';
let prefix = process.argv[2];

// Remove leading slash if present
if (prefix.startsWith('/')) {
  prefix = prefix.substring(1);
}

const outputFile = process.argv[3] || 'files.csv';
const shardCount = parseInt(process.argv[4] || '16', 10);

if (shardCount < 1 || shardCount > 256) {
  console.error('Error: shard-count must be between 1 and 256');
  process.exit(1);
}

// Load environment variables
const loadEnvVars = () => {
  const possiblePaths = [
    path.join(__dirname, '../.dev.vars'),
    path.join(__dirname, '.dev.vars'),
    path.join(process.cwd(), '.dev.vars'),
    path.join(process.cwd(), '../.dev.vars'),
  ];
  
  let envPath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      envPath = p;
      break;
    }
  }
  
  if (!envPath) {
    throw new Error('.dev.vars file not found. Tried: ' + possiblePaths.join(', '));
  }
  
  const envContent = fs.readFileSync(envPath, 'utf8');
  const envVars = {};
  
  envContent.split('\n').forEach(line => {
    if (line.trim() && !line.startsWith('#')) {
      const [key, value] = line.split('=');
      if (key && value) {
        envVars[key.trim()] = value.trim();
      }
    }
  });
  
  return envVars;
};

const envVars = loadEnvVars();

// Configure S3 client
const s3Client = new S3Client({
  credentials: {
    accessKeyId: envVars.S3_ACCESS_KEY_ID,
    secretAccessKey: envVars.S3_SECRET_ACCESS_KEY,
  },
  endpoint: envVars.S3_DEF_URL,
  forcePathStyle: true,
  region: 'auto',
  maxAttempts: 3
});

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

// Generate shard prefixes using hex characters for even distribution
// Plus a catch-all shard for files starting with non-hex characters
function generateShardPrefixes(basePrefix, count) {
  if (count === 1) {
    return [{ prefix: basePrefix, type: 'catch-all' }];
  }
  
  // Reserve one shard for catch-all (files starting with ., _, capitals, etc.)
  const hexShardCount = count - 1;
  
  // Use hex characters for sharding (0-9, a-f)
  const hexChars = '0123456789abcdef';
  const shards = [];
  
  // Add catch-all shard first (no additional prefix character)
  // This catches files starting with: ., _, A-Z, and other non-hex characters
  shards.push({ prefix: basePrefix, type: 'catch-all' });
  
  // Determine shard width based on count
  // For 16 shards: single hex char (0-f) + 1 catch-all
  // For 256 shards: two hex chars (00-ff) + 1 catch-all
  if (hexShardCount <= 16) {
    // Single character sharding
    const step = Math.ceil(16 / hexShardCount);
    for (let i = 0; i < 16; i += step) {
      const shardPrefix = basePrefix + hexChars[i];
      shards.push({ prefix: shardPrefix, type: 'hex' });
    }
  } else {
    // Two character sharding
    const step = Math.ceil(256 / hexShardCount);
    for (let i = 0; i < 256; i += step) {
      const char1 = hexChars[Math.floor(i / 16)];
      const char2 = hexChars[i % 16];
      const shardPrefix = basePrefix + char1 + char2;
      shards.push({ prefix: shardPrefix, type: 'hex' });
    }
  }
  
  return shards.slice(0, count);
}

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
        // Filter keys for catch-all shard to avoid duplicates with hex shards
        let keysToProcess = response.Contents;
        
        if (isCatchAll) {
          // For catch-all shard, only process keys that don't start with hex characters
          const hexPattern = /^[0-9a-f]/i;
          keysToProcess = response.Contents.filter(obj => {
            const keyAfterPrefix = obj.Key.substring(shardPrefix.length);
            return keyAfterPrefix && !hexPattern.test(keyAfterPrefix);
          });
        }
        
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
    const shardLabel = isCatchAll ? `${shardPrefix}[^0-9a-f]*` : `${shardPrefix}*`;
    console.log(`✓ Shard ${shardId} (${shardLabel}): ${shardKeyCount} keys in ${duration}s`);
    
    return shardKeyCount;
    
  } catch (error) {
    stats.activeShards--;
    const shardLabel = isCatchAll ? `${shardPrefix}[^0-9a-f]*` : `${shardPrefix}*`;
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
  console.log(`Shards: ${shardCount} concurrent`);
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
    console.log(`Generated ${shards.length} shard prefixes`);
    const catchAllCount = shards.filter(s => s.type === 'catch-all').length;
    const hexCount = shards.filter(s => s.type === 'hex').length;
    console.log(`  - ${catchAllCount} catch-all shard (for ., _, capitals, etc.)`);
    console.log(`  - ${hexCount} hex shards (0-9, a-f)`);
    console.log('Shard prefixes:', shards.map(s => s.type === 'catch-all' ? s.prefix + '[^0-9a-f]*' : s.prefix + '*').join(', '));
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

