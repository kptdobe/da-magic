/**
 * Shared S3 utilities for traverse and find operations
 */

const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { generateShardPrefixes, filterObjectsByShard, getShardStats } = require('./sharding.js');

/**
 * Load environment variables from .dev.vars file
 * @returns {Object} Environment variables
 */
function loadEnvVars() {
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
}

/**
 * Create configured S3 client with optimized settings
 * @param {Object} envVars - Environment variables with S3 credentials
 * @returns {S3Client} Configured S3 client
 */
function createS3Client(envVars) {
  return new S3Client({
    credentials: {
      accessKeyId: envVars.S3_ACCESS_KEY_ID,
      secretAccessKey: envVars.S3_SECRET_ACCESS_KEY,
    },
    endpoint: envVars.S3_DEF_URL,
    forcePathStyle: true,
    region: 'auto',
    maxAttempts: 3,
    requestHandler: new NodeHttpHandler({
    httpsAgent: new https.Agent({
      maxSockets: 500, // Safe limit for macOS (ulimit usually >256)
      keepAlive: true,
      keepAliveMsecs: 1000
    }),
      socketAcquisitionWarningTimeout: 10000
    })
  });
}

/**
 * List all objects in a shard with pagination
 * @param {S3Client} s3Client - Configured S3 client
 * @param {string} bucket - S3 bucket name
 * @param {Object} shard - Shard configuration
 * @param {string} basePrefix - Base prefix before sharding
 * @param {Function} onBatch - Callback for each batch of objects
 * @returns {Promise<number>} Total objects found
 */
async function listShardObjects(s3Client, bucket, shard, basePrefix, onBatch) {
  let continuationToken = null;
  let totalCount = 0;
  const shardPrefix = shard.prefix;
  
  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: shardPrefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken
    });
    
    const response = await s3Client.send(command);
    
    if (response.Contents && response.Contents.length > 0) {
      // Filter objects for this shard to avoid duplicates
      const filteredObjects = filterObjectsByShard(response.Contents, shard, basePrefix);
      
      totalCount += filteredObjects.length;
      
      // Call batch processor
      if (onBatch && filteredObjects.length > 0) {
        await onBatch(filteredObjects);
      }
    }
    
    continuationToken = response.NextContinuationToken;
    
  } while (continuationToken);
  
  return totalCount;
}

/**
 * Process shards in parallel with progress tracking
 * @param {Object} options - Configuration options
 * @param {S3Client} options.s3Client - Configured S3 client
 * @param {string} options.bucket - S3 bucket name
 * @param {string} options.prefix - Base prefix to process
 * @param {number} options.shardCount - Number of shards (usually 63)
 * @param {Function} options.processObject - Function to process each object
 * @param {Function} options.onProgress - Progress callback
 * @param {Function} options.onShardComplete - Shard completion callback
 * @returns {Promise<Object>} Final statistics
 */
async function processShards(options) {
  const {
    s3Client,
    bucket,
    prefix,
    shardCount = 63,
    processObject,
    onProgress,
    onShardComplete
  } = options;
  
  // Generate shards
  const shards = generateShardPrefixes(prefix, shardCount);
  
  // Stats tracking
  const stats = {
    totalObjects: 0,
    processedObjects: 0,
    totalShards: 0,
    completedShards: 0,
    activeShards: 0,
    startTime: Date.now(),
    lastUpdate: Date.now()
  };
  
  // Process single shard
  async function processShard(shard, shardId) {
    stats.totalShards++;
    stats.activeShards++;
    
    const startTime = Date.now();
    let shardObjectCount = 0;
    
    try {
      // List and process objects
      const count = await listShardObjects(
        s3Client,
        bucket,
        shard,
        prefix,
        async (objects) => {
          shardObjectCount += objects.length;
          stats.totalObjects += objects.length;
          
          // Process each object
          if (processObject) {
            for (const obj of objects) {
              await processObject(obj, shard);
              stats.processedObjects++;
            }
          }
          
          // Progress update
          if (onProgress && Date.now() - stats.lastUpdate > 10000) {
            stats.lastUpdate = Date.now();
            onProgress(stats);
          }
        }
      );
      
      stats.completedShards++;
      stats.activeShards--;
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      if (onShardComplete) {
        onShardComplete({
          shardId,
          shard,
          objectCount: shardObjectCount,
          duration,
          success: true
        });
      }
      
      return shardObjectCount;
      
    } catch (error) {
      stats.activeShards--;
      
      if (onShardComplete) {
        onShardComplete({
          shardId,
          shard,
          objectCount: 0,
          duration: 0,
          success: false,
          error: error.message
        });
      }
      
      return 0;
    }
  }
  
  // Process all shards in parallel
  const shardPromises = shards.map((shard, index) => 
    processShard(shard, index + 1)
  );
  
  await Promise.all(shardPromises);
  
  return stats;
}

/**
 * Format shard label for display
 * @param {Object} shard - Shard configuration
 * @returns {string} Formatted label
 */
function formatShardLabel(shard) {
  const isCatchAll = shard.type === 'catch-all';
  const shardPrefix = shard.prefix;
  
  if (isCatchAll) {
    return `${shardPrefix}[^0-9a-zA-Z]*`;
  } else if (shard.charRange && shard.charRange.length > 1) {
    return `${shardPrefix}[${shard.charRange[0]}-${shard.charRange[shard.charRange.length-1]}]`;
  } else {
    return `${shardPrefix}*`;
  }
}

/**
 * Display shard information
 * @param {Array} shards - Array of shard configurations
 */
function displayShardInfo(shards) {
  const shardStats = getShardStats(shards);
  
  console.log(`Generated ${shards.length} shard prefixes`);
  if (shardStats.catchAll > 0) {
    console.log(`  - ${shardStats.catchAll} catch-all shard (for ., _, etc.)`);
  }
  if (shardStats.alphanum > 0) {
    console.log(`  - ${shardStats.alphanum} alphanumeric shards (0-9, A-Z, a-z)`);
  }
  if (shardStats.all > 0) {
    console.log(`  - ${shardStats.all} shard (all files)`);
  }
  
  // Show sample of shard prefixes (limit to first 20)
  const prefixSamples = shards.slice(0, 20).map(formatShardLabel);
  console.log('Shard prefixes:', prefixSamples.join(', ') + (shards.length > 20 ? ', ...' : ''));
}

module.exports = {
  loadEnvVars,
  createS3Client,
  listShardObjects,
  processShards,
  formatShardLabel,
  displayShardInfo,
  generateShardPrefixes,
  filterObjectsByShard,
  getShardStats
};

