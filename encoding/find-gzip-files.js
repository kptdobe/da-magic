#!/usr/bin/env node
// Find all files with gzip ContentEncoding in S3 bucket using sharded traversal
// Also outputs ALL files to files.csv with metadata
// Usage: node find-gzip-files.js <prefix> [output-file]

const { HeadObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const { 
  loadEnvVars, 
  createS3Client, 
  processShards,
  displayShardInfo,
  generateShardPrefixes
} = require('../traverse/s3-utils.js');

// Parse command line arguments
if (process.argv.length < 3) {
  console.error('Usage: node find-gzip-files.js <prefix> [output-file]');
  console.error('Example: node find-gzip-files.js cmegroup/www/drafts');
  console.error('Example: node find-gzip-files.js cmegroup/www/drafts my-gzip-files.txt');
  console.error('');
  console.error('Output: [output-file] = gzip files only, files.csv = all files with metadata');
  process.exit(1);
}

const bucket = 'aem-content';
// Ensure prefix doesn't start with slash and ends with slash if it's a folder
let prefix = process.argv[2].replace(/^\/+/, '');
// If prefix is not empty and doesn't end with slash, we treat it as a folder prefix 
// but we don't force it because user might want to match a file prefix
// However, typically for "folder" scans we want the slash. 
// The original script didn't force it, so we'll leave it as is.

const outputFile = process.argv[3] || 'list.txt';
const allFilesOutput = 'files.csv';

// Create file streams
let outputStream = null;
let allFilesStream = null;

// Stats
const detailedStats = {
  totalFiles: 0,
  gzipFiles: 0,
  nonGzipFiles: 0,
  errors: 0,
  startTime: Date.now()
};

const gzipFiles = [];

// Helper to escape CSV fields
function escapeCSV(field) {
  if (field === null || field === undefined) {
    return '';
  }
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Function to check if a file has gzip encoding
async function checkFileEncoding(s3Client, bucket, key, listMetadata) {
  try {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const metadata = await s3Client.send(command);
    const contentEncoding = metadata.ContentEncoding || null;
    
    detailedStats.totalFiles++;
    
    // Write all files to CSV
    if (allFilesStream) {
      // Use size from HeadObject (most accurate) or fallback to ListObjects data
      const contentLength = metadata.ContentLength ?? listMetadata.Size ?? 0;
      const lastModified = metadata.LastModified 
        ? metadata.LastModified.toISOString() 
        : (listMetadata.LastModified ? listMetadata.LastModified.toISOString() : '');
        
      allFilesStream.write(`${escapeCSV(key)},${contentLength},${escapeCSV(lastModified)}\n`);
    }
    
    if (contentEncoding === 'gzip') {
      detailedStats.gzipFiles++;
      gzipFiles.push({
        key: key,
        size: metadata.ContentLength,
        contentType: metadata.ContentType,
        lastModified: metadata.LastModified
      });
      
      if (outputStream) {
        outputStream.write(key + '\n');
      }
    } else {
      detailedStats.nonGzipFiles++;
    }
  } catch (error) {
    detailedStats.errors++;
    // If 404, file might have been deleted between List and Head
    if (error.name !== 'NotFound' && error.$metadata?.httpStatusCode !== 404) {
      console.error(`Error checking ${key}: ${error.message}`);
    }
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('S3 Gzip-Encoded Files Finder (Sharded)');
  console.log('='.repeat(60));
  console.log(`Bucket: ${bucket}`);
  console.log(`Prefix: ${prefix}`);
  
  try {
    const envVars = loadEnvVars();
    const s3Client = createS3Client(envVars);
    
    // Setup streams
    outputStream = fs.createWriteStream(outputFile);
    allFilesStream = fs.createWriteStream(allFilesOutput);
    
    // Write CSV header
    allFilesStream.write('FilePath,ContentLength,LastModified\n');
    
    // Show shard info
    const shards = generateShardPrefixes(prefix, 63);
    displayShardInfo(shards);
    console.log(`\nScanning with ~${shards.length} concurrent workers...`);
    
    const stats = await processShards({
      s3Client,
      bucket,
      prefix,
      shardCount: 63,
      processBatch: async (objects, shard) => {
        // Filter out .da-versions
        const filteredObjects = objects.filter(obj => !obj.Key.includes('/.da-versions/'));
        
        // Process in parallel chunks to maximize throughput but respect limits
        // 50 concurrent HeadObject calls per shard batch is aggressive but fast
        // Since we have 66 shards, we need to be careful not to explode MAX_SOCKETS (500)
        // However, not all shards are active at once or returning data at the exact same time
        const batchSize = 20; 
        
        for (let i = 0; i < filteredObjects.length; i += batchSize) {
          const batch = filteredObjects.slice(i, i + batchSize);
          await Promise.all(batch.map(obj => checkFileEncoding(s3Client, bucket, obj.Key, obj)));
        }
      },
      onProgress: (s) => {
        process.stdout.write(`\rScanned: ${s.totalObjects} | Checked: ${detailedStats.totalFiles} | Gzip: ${detailedStats.gzipFiles} | Errors: ${detailedStats.errors} | Active Shards: ${s.activeShards}  `);
      },
      onShardComplete: (s) => {
        if (!s.success) {
          console.error(`\nShard failed: ${s.shard.prefix} - ${s.error}`);
        }
      }
    });
    
    console.log('\n\n' + '='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));
    console.log(`Total objects scanned: ${stats.totalObjects}`);
    console.log(`Total files checked:   ${detailedStats.totalFiles}`);
    console.log(`Gzip-encoded files:    ${detailedStats.gzipFiles}`);
    console.log(`Non-gzip files:        ${detailedStats.nonGzipFiles}`);
    console.log(`Errors:                ${detailedStats.errors}`);
    
    const duration = ((Date.now() - detailedStats.startTime) / 1000).toFixed(2);
    console.log(`Duration:              ${duration}s`);
    
    if (gzipFiles.length > 0) {
      console.log('\nSample gzip files:');
      gzipFiles.slice(0, 5).forEach(f => console.log(`- ${f.key}`));
      if (gzipFiles.length > 5) console.log(`... and ${gzipFiles.length - 5} more`);
    } else {
      console.log('\nNo gzip-encoded files found.');
    }
    
    console.log(`\nGzip list: ${outputFile}`);
    console.log(`All files: ${allFilesOutput}`);
    
  } catch (error) {
    console.error('\nFatal Error:', error.message);
    process.exit(1);
  } finally {
    if (outputStream) outputStream.end();
    if (allFilesStream) allFilesStream.end();
  }
}

main();
