#!/usr/bin/env node
// Find all HTML and JSON documents containing URLs with .hlx.page or .hlx.live domains
// Extracts and reports the full URLs (including paths) found in the files
// Usage: node find-hlx-ref.js <prefix> [output-file] [shard-count]
// Example: node find-hlx-ref.js cmegroup/www/drafts
// Example: node find-hlx-ref.js cmegroup/www/drafts hlx-references.txt 16
// Note: Automatically ignores .da-versions and .trash folders

const { ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const {
  loadEnvVars,
  createS3Client,
  generateShardPrefixes,
  filterObjectsByShard,
  listShardObjects,
  displayShardInfo,
  formatShardLabel
} = require('../traverse/s3-utils.js');

// Parse command line arguments
if (process.argv.length < 3) {
  console.error('Usage: node find-hlx-ref.js <prefix> [output-file]');
  console.error('Example: node find-hlx-ref.js cmegroup/www/drafts');
  console.error('Example: node find-hlx-ref.js cmegroup/www/drafts hlx-references.txt');
  console.error('');
  console.error('Arguments:');
  console.error('  prefix       - Path prefix to search (e.g., cmegroup/www/drafts)');
  console.error('  output-file  - Output file for results (default: hlx-references.txt)');
  console.error('');
  console.error('Note: Always uses 63 concurrent shards for complete coverage');
  console.error('      (1 catch-all + 62 alphanumeric: 0-9, A-Z, a-z)');
  console.error('');
  console.error('Description:');
  console.error('  Searches HTML (.html, .htm) and JSON (.json) files for .hlx.page and .hlx.live URLs');
  console.error('  Automatically ignores .da-versions and .trash folders');
  process.exit(1);
}

const bucket = 'aem-content';  // Hardcoded bucket name
let prefix = process.argv[2];
// Remove leading slash if present (S3 keys don't start with /)
if (prefix.startsWith('/')) {
  prefix = prefix.substring(1);
}
const outputFile = process.argv[3] || 'hlx-references.txt';
// Note: shardCount parameter is kept for API compatibility but always uses 63 internally
const shardCount = 63; // Always use 63 for complete coverage (1 catch-all + 62 alphanumeric)

// Create file stream for progressive output
let outputStream = null;

// Initialize S3 client
const envVars = loadEnvVars();
const s3Client = createS3Client(envVars);

// Statistics
const stats = {
  totalFiles: 0,
  htmlFiles: 0,
  jsonFiles: 0,
  processedFiles: 0,
  filesWithHlxRefs: 0,
  totalHlxRefs: 0,
  hlxPageRefs: 0,
  hlxLiveRefs: 0,
  errors: 0,
  totalShards: 0,
  completedShards: 0,
  activeShards: 0,
  startTime: Date.now(),
  lastUpdate: Date.now()
};

// Array to store files with HLX references
const filesWithRefs = [];

// Regex patterns to match full URLs containing .hlx.page or .hlx.live
// Matches URLs in href, src, and other attributes, including protocol and path
const URL_PATTERN = /https?:\/\/[^\s"'<>]+\.hlx\.(page|live)[^\s"'<>]*/gi;

// Function to check if a file should be processed (HTML or JSON)
function shouldProcessFile(key) {
  // Skip .da-versions and .trash folders
  if (key.includes('/.da-versions/') || key.includes('/.trash/')) {
    return false;
  }
  
  // Check if HTML or JSON file
  const lowerKey = key.toLowerCase();
  return lowerKey.endsWith('.html') || lowerKey.endsWith('.htm') || lowerKey.endsWith('.json');
}

// Function to read and search file content (HTML or JSON)
async function searchFileContent(bucket, key) {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const response = await s3Client.send(command);
    
    // Convert stream to string
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    let content = Buffer.concat(chunks).toString('utf-8');
    
    // Extract all URLs containing .hlx.page or .hlx.live
    const urlMatches = content.match(URL_PATTERN) || [];
    
    // Clear content to free memory immediately
    content = null;
    
    if (urlMatches.length > 0) {
      // Deduplicate URLs (same URL might appear multiple times in the HTML)
      const uniqueUrls = [...new Set(urlMatches)];
      
      // Separate by domain type
      const hlxPageUrls = uniqueUrls.filter(url => url.includes('.hlx.page'));
      const hlxLiveUrls = uniqueUrls.filter(url => url.includes('.hlx.live'));
      
      stats.filesWithHlxRefs++;
      stats.totalHlxRefs += uniqueUrls.length;
      stats.hlxPageRefs += hlxPageUrls.length;
      stats.hlxLiveRefs += hlxLiveUrls.length;
      
      console.log(`✓ ${key}`);
      console.log(`  FOUND: ${hlxPageUrls.length} .hlx.page URLs, ${hlxLiveUrls.length} .hlx.live URLs`);
      
      // Store minimal info only (no URLs to save memory)
      const fileInfo = {
        key: key,
        hlxPageCount: hlxPageUrls.length,
        hlxLiveCount: hlxLiveUrls.length,
        totalCount: uniqueUrls.length,
        size: response.ContentLength
      };
      
      filesWithRefs.push(fileInfo);
      
      // Write to output file immediately - one line per URL
      if (outputStream) {
        hlxPageUrls.forEach(url => {
          outputStream.write(`${key}\t.hlx.page\t${url}\n`);
        });
        hlxLiveUrls.forEach(url => {
          outputStream.write(`${key}\t.hlx.live\t${url}\n`);
        });
      }
      
      return true;
    }
    
    return false;
  } catch (error) {
    stats.errors++;
    console.error(`✗ Error reading ${key}: ${error.message}`);
    return false;
  }
}

// List and process all HTML and JSON files in a shard
async function listAndProcessShard(shard, shardId) {
  stats.totalShards++;
  stats.activeShards++;
  
  let continuationToken = null;
  let shardFileCount = 0;
  let shardProcessCount = 0;
  let shardHtmlCount = 0;
  let shardJsonCount = 0;
  const startTime = Date.now();
  const shardPrefix = shard.prefix;
  const isCatchAll = shard.type === 'catch-all';
  
  const filesToProcess = [];
  
  try {
    // First pass: List all objects in this shard
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
        
        shardFileCount += keysToProcess.length;
        stats.totalFiles += keysToProcess.length;
        
        // Filter for HTML and JSON files to process
        const processableFiles = keysToProcess.filter(obj => shouldProcessFile(obj.Key));
        shardProcessCount += processableFiles.length;
        
        // Count HTML and JSON separately
        processableFiles.forEach(obj => {
          const lowerKey = obj.Key.toLowerCase();
          if (lowerKey.endsWith('.html') || lowerKey.endsWith('.htm')) {
            shardHtmlCount++;
            stats.htmlFiles++;
          } else if (lowerKey.endsWith('.json')) {
            shardJsonCount++;
            stats.jsonFiles++;
          }
        });
        
        stats.processedFiles += processableFiles.length;
        filesToProcess.push(...processableFiles);
      }
      
      continuationToken = response.NextContinuationToken;
      
      // Progress update every 10 seconds
      if (Date.now() - stats.lastUpdate > 10000) {
        const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
        console.log(`[${elapsed}s] Total: ${stats.totalFiles} files, ${stats.htmlFiles} HTML, ${stats.jsonFiles} JSON | With refs: ${stats.filesWithHlxRefs} | Active: ${stats.activeShards} | Completed: ${stats.completedShards}/${stats.totalShards}`);
        stats.lastUpdate = Date.now();
      }
      
    } while (continuationToken);
    
    // Second pass: Process HTML and JSON files in batches
    if (filesToProcess.length > 0) {
      const batchSize = 50; // Increased from 10 for better throughput
      for (let i = 0; i < filesToProcess.length; i += batchSize) {
        const batch = filesToProcess.slice(i, i + batchSize);
        const batchPromises = batch.map(obj => searchFileContent(bucket, obj.Key));
        await Promise.all(batchPromises);
      }
    }
    
    stats.completedShards++;
    stats.activeShards--;
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const shardLabel = formatShardLabel(shard);
    console.log(`✓ Shard ${shardId} (${shardLabel}): ${shardFileCount} files, ${shardHtmlCount} HTML, ${shardJsonCount} JSON in ${duration}s`);
    
    return shardFileCount;
    
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
  console.log('S3 HLX Reference Finder (Sharded)');
  console.log('='.repeat(70));
  console.log(`Bucket: ${bucket}`);
  console.log(`Prefix: ${prefix}`);
  console.log(`Output file: ${outputFile}`);
  console.log(`Shards: 63 concurrent (complete coverage)`);
  console.log('');
  console.log('Searching for: .hlx.page and .hlx.live references');
  console.log('File types: HTML (.html, .htm) and JSON (.json)');
  console.log('Note: Automatically ignores .da-versions and .trash folders');
  console.log('');
  
  // Create output file stream
  outputStream = fs.createWriteStream(outputFile);
  outputStream.write('File Path\tType\tURL\n');
  outputStream.on('error', (err) => {
    console.error(`Error writing to ${outputFile}:`, err.message);
  });
  
  try {
    // Generate shard prefixes
    const shards = generateShardPrefixes(prefix, shardCount);
    displayShardInfo(shards);
    
    console.log('');
    console.log('Starting search...');
    console.log('');
    
    stats.startTime = Date.now();
    stats.lastUpdate = Date.now();
    
    // Process all shards concurrently
    const shardPromises = shards.map((shard, index) => 
      listAndProcessShard(shard, index + 1)
    );
    
    await Promise.all(shardPromises);
    
    // Close output stream
    outputStream.end();
    
    // Display results
    console.log('');
    console.log('='.repeat(70));
    console.log('RESULTS');
    console.log('='.repeat(70));
    console.log(`Total files scanned: ${stats.totalFiles.toLocaleString()}`);
    console.log(`HTML files found: ${stats.htmlFiles.toLocaleString()}`);
    console.log(`JSON files found: ${stats.jsonFiles.toLocaleString()}`);
    console.log(`Files processed: ${stats.processedFiles.toLocaleString()}`);
    console.log(`Files with HLX references: ${stats.filesWithHlxRefs}`);
    console.log(`Total .hlx.page references: ${stats.hlxPageRefs}`);
    console.log(`Total .hlx.live references: ${stats.hlxLiveRefs}`);
    console.log(`Total HLX references: ${stats.totalHlxRefs}`);
    console.log(`Errors: ${stats.errors}`);
    console.log(`Total shards: ${stats.totalShards}`);
    console.log(`Successful shards: ${stats.completedShards}`);
    console.log(`Failed shards: ${stats.totalShards - stats.completedShards}`);
    
    const duration = ((Date.now() - stats.startTime) / 1000).toFixed(2);
    console.log(`Duration: ${duration}s`);
    
    const filesPerSecond = (stats.totalFiles / (duration || 1)).toFixed(0);
    console.log(`Throughput: ${filesPerSecond} files/second`);
    console.log('');
    
    if (filesWithRefs.length > 0) {
      console.log('='.repeat(70));
      console.log('SUMMARY: FILES WITH HLX REFERENCES');
      console.log('='.repeat(70));
      
      // Sort by total count (descending) for easier analysis
      filesWithRefs.sort((a, b) => b.totalCount - a.totalCount);
      
      filesWithRefs.forEach((file, index) => {
        console.log(`${index + 1}. ${file.key}`);
        console.log(`   .hlx.page URLs: ${file.hlxPageCount}`);
        console.log(`   .hlx.live URLs: ${file.hlxLiveCount}`);
        console.log(`   Total unique URLs: ${file.totalCount}`);
        console.log(`   Size: ${formatBytes(file.size)}`);
        console.log('');
      });
      
      // Also output a simple list for easy copying
      console.log('='.repeat(70));
      console.log('FILE PATHS (for batch processing)');
      console.log('='.repeat(70));
      filesWithRefs.forEach(file => {
        console.log(file.key);
      });
      console.log('');
    } else {
      console.log('No HLX references found! ✓');
      console.log('');
    }
    
    console.log(`Detailed results written to: ${outputFile}`);
    console.log('✓ Search complete!');
    console.log('');
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    if (outputStream) {
      outputStream.end();
    }
    process.exit(1);
  }
}

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

