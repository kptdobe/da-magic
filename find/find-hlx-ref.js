#!/usr/bin/env node
// Find all HTML documents containing URLs with .hlx.page or .hlx.live domains
// Extracts and reports the full URLs (including paths) found in the HTML
// Usage: node find-hlx-ref.js <prefix> [output-file]
// Example: node find-hlx-ref.js cmegroup/www/drafts
// Example: node find-hlx-ref.js cmegroup/www/drafts hlx-references.txt
// Note: Automatically ignores .da-versions and .trash folders

const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
if (process.argv.length < 3) {
  console.error('Usage: node find-hlx-ref.js <prefix> [output-file]');
  console.error('Example: node find-hlx-ref.js cmegroup/www/drafts');
  console.error('Example: node find-hlx-ref.js cmegroup/www/drafts hlx-references.txt');
  process.exit(1);
}

const bucket = 'aem-content';  // Hardcoded bucket name
let prefix = process.argv[2];
// Remove leading slash if present (S3 keys don't start with /)
if (prefix.startsWith('/')) {
  prefix = prefix.substring(1);
}
const outputFile = process.argv[3] || 'hlx-references.txt';

// Create file stream for progressive output
let outputStream = null;

// Load environment variables from .dev.vars (relative to where script is run from)
const loadEnvVars = () => {
  // Try multiple possible locations
  const possiblePaths = [
    path.join(__dirname, '../.dev.vars'),               // From find folder to root
    path.join(__dirname, '../../.dev.vars'),            // From find folder up two levels
    path.join(__dirname, '../encoding/.dev.vars'),      // From find folder to encoding
    path.join(process.cwd(), '.dev.vars'),              // From current directory
    path.join(process.cwd(), '../.dev.vars'),           // From current directory parent
    path.join(process.cwd(), '../../.dev.vars')         // From current directory grandparent
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

// Configure S3 client with higher connection limits
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
  totalFiles: 0,
  htmlFiles: 0,
  filesWithHlxRefs: 0,
  totalHlxRefs: 0,
  hlxPageRefs: 0,
  hlxLiveRefs: 0,
  errors: 0,
  startTime: Date.now()
};

// Array to store files with HLX references
const filesWithRefs = [];

// Regex patterns to match full URLs containing .hlx.page or .hlx.live
// Matches URLs in href, src, and other attributes, including protocol and path
const URL_PATTERN = /https?:\/\/[^\s"'<>]+\.hlx\.(page|live)[^\s"'<>]*/gi;

// Function to list objects in current folder only (not recursive)
async function listCurrentFolderObjects(bucket, prefix) {
  let continuationToken = null;
  const allObjects = [];
  
  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/', // This makes it list only current folder contents
      ContinuationToken: continuationToken,
      MaxKeys: 1000
    });
    
    const response = await s3Client.send(command);
    
    if (response.Contents && response.Contents.length > 0) {
      allObjects.push(...response.Contents);
    }
    
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  
  return allObjects;
}

// Function to discover subfolders in current directory
async function discoverSubfolders(bucket, prefix) {
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    Delimiter: '/',
    MaxKeys: 1000
  });
  
  const response = await s3Client.send(command);
  const subfolders = [];
  
  if (response.CommonPrefixes) {
    response.CommonPrefixes.forEach(prefixObj => {
      // Filter out .da-versions and .trash folders
      if (!prefixObj.Prefix.includes('/.da-versions/') && 
          !prefixObj.Prefix.includes('/.trash/')) {
        subfolders.push(prefixObj.Prefix);
      }
    });
  }
  
  return subfolders;
}

// Function to check if a file is HTML
function isHtmlFile(key) {
  const lowerKey = key.toLowerCase();
  return lowerKey.endsWith('.html') || lowerKey.endsWith('.htm');
}

// Function to read and search HTML content
async function searchHtmlContent(bucket, key) {
  try {
    // Log the file being checked
    console.log(`Checking: ${key}`);
    
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
    let htmlContent = Buffer.concat(chunks).toString('utf-8');
    
    // Extract all URLs containing .hlx.page or .hlx.live
    const urlMatches = htmlContent.match(URL_PATTERN) || [];
    
    // Clear htmlContent to free memory immediately
    htmlContent = null;
    
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
      
      console.log(`  ✓ FOUND: ${hlxPageUrls.length} .hlx.page URLs, ${hlxLiveUrls.length} .hlx.live URLs`);
      
      // Display URLs immediately to console
      if (hlxPageUrls.length > 0) {
        console.log(`     .hlx.page URLs:`);
        hlxPageUrls.forEach(url => {
          console.log(`       - ${url}`);
        });
      }
      if (hlxLiveUrls.length > 0) {
        console.log(`     .hlx.live URLs:`);
        hlxLiveUrls.forEach(url => {
          console.log(`       - ${url}`);
        });
      }
      
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
    console.error(`\nError reading ${key}: ${error.message}`);
    return false;
  }
}

// Function to process a folder and its subfolders recursively
async function processFolder(bucket, folderPrefix, batchSize = 50) {
  // List files in current folder only
  const objects = await listCurrentFolderObjects(bucket, folderPrefix);
  
  // Filter for HTML files only
  const htmlObjects = objects.filter(obj => 
    !obj.Key.includes('/.da-versions/') && 
    !obj.Key.includes('/.trash/') &&
    isHtmlFile(obj.Key) &&
    !obj.Key.endsWith('/') // Exclude directory markers
  );
  
  stats.totalFiles += objects.length;
  stats.htmlFiles += htmlObjects.length;
  
  if (htmlObjects.length > 0) {
    // Process HTML files in current folder immediately with batching
    await processBatchImmediate(htmlObjects, batchSize);
  }
  
  // Discover subfolders
  const subfolders = await discoverSubfolders(bucket, folderPrefix);
  
  let totalObjectsInSubfolders = 0;
  
  if (subfolders.length > 0) {
    // Process subfolders with limited concurrency to reduce memory usage
    const maxConcurrentSubfolders = 5;
    for (let i = 0; i < subfolders.length; i += maxConcurrentSubfolders) {
      const batch = subfolders.slice(i, i + maxConcurrentSubfolders);
      const subfolderPromises = batch.map(subfolder => 
        processFolder(bucket, subfolder, batchSize)
      );
      const subfolderResults = await Promise.all(subfolderPromises);
      totalObjectsInSubfolders += subfolderResults.reduce((sum, count) => sum + count, 0);
    }
  }
  
  return objects.length + totalObjectsInSubfolders;
}

// Function to process a batch immediately (used during listing)
async function processBatchImmediate(htmlObjects, batchSize = 10) {
  for (let i = 0; i < htmlObjects.length; i += batchSize) {
    const batch = htmlObjects.slice(i, i + batchSize);
    const batchPromises = batch.map(obj => searchHtmlContent(bucket, obj.Key));
    await Promise.all(batchPromises);
  }
}

// Main function
async function main() {
  console.log('='.repeat(70));
  console.log('S3 HTML HLX Reference Finder');
  console.log('='.repeat(70));
  console.log(`Bucket: ${bucket}`);
  console.log(`Prefix: ${prefix}`);
  console.log(`Output file: ${outputFile}`);
  console.log('');
  console.log('Searching for: .hlx.page and .hlx.live references');
  console.log('');
  
  // Create output file stream
  outputStream = fs.createWriteStream(outputFile);
  outputStream.write('File Path\tType\tURL\n');
  outputStream.on('error', (err) => {
    console.error(`Error writing to ${outputFile}:`, err.message);
  });
  
  try {
    // Process folder and subfolders recursively with parallel subfolder processing
    console.log('Scanning HTML documents and searching for HLX references...');
    console.log('(Processing files in current folder, then parallelizing subfolders)');
    console.log('');
    
    const totalObjects = await processFolder(bucket, prefix, 10); // Conservative batch size for memory efficiency
    
    if (totalObjects === 0) {
      console.log('No objects found with the specified prefix.');
      return;
    }
    
    // Display results
    console.log('');
    console.log('='.repeat(70));
    console.log('RESULTS');
    console.log('='.repeat(70));
    console.log(`Total files scanned: ${stats.totalFiles}`);
    console.log(`HTML files found: ${stats.htmlFiles}`);
    console.log(`HTML files with HLX references: ${stats.filesWithHlxRefs}`);
    console.log(`Total .hlx.page references: ${stats.hlxPageRefs}`);
    console.log(`Total .hlx.live references: ${stats.hlxLiveRefs}`);
    console.log(`Total HLX references: ${stats.totalHlxRefs}`);
    console.log(`Errors: ${stats.errors}`);
    
    const duration = ((Date.now() - stats.startTime) / 1000).toFixed(2);
    console.log(`Duration: ${duration}s`);
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
        console.log(`/${file.key}`);
      });
    } else {
      console.log('No HLX references found! ✓');
    }
    
    // Close output stream
    if (outputStream) {
      outputStream.end();
      console.log(`\nDetailed results written to: ${outputFile}`);
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

