#!/usr/bin/env node
// Find all files with gzip ContentEncoding in S3 bucket
// Also outputs ALL files to files.csv with metadata during traversal (bonus!)
// Usage: node find-gzip-files.js <prefix> [output-file]
// Example: node find-gzip-files.js cmegroup/www/drafts
// Example: node find-gzip-files.js cmegroup/www/drafts my-gzip-files.txt
// Note: Automatically ignores .da-versions folders
// Output: [output-file] = gzip files only, files.csv = all files with metadata (path, size, last modified)

const { S3Client, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
if (process.argv.length < 3) {
  console.error('Usage: node find-gzip-files.js <prefix> [output-file]');
  console.error('Example: node find-gzip-files.js cmegroup/www/drafts');
  console.error('Example: node find-gzip-files.js cmegroup/www/drafts my-gzip-files.txt');
  console.error('');
  console.error('Output: [output-file] = gzip files only, files.csv = all files with metadata');
  process.exit(1);
}

const bucket = 'aem-content';  // Hardcoded bucket name
const prefix = process.argv[2];
const outputFile = process.argv[3] || 'list.txt';
const allFilesOutput = 'files.csv';  // CSV output file for all files with metadata

// Create file streams for progressive output
let outputStream = null;  // For gzip-encoded files
let allFilesStream = null;  // For all files CSV

// Load environment variables from .dev.vars (relative to where script is run from)
const loadEnvVars = () => {
  // Try multiple possible locations
  const possiblePaths = [
    path.join(__dirname, '../.dev.vars'),           // From encoding folder
    path.join(__dirname, '../../.dev.vars'),        // From admin/backend folder
    path.join(process.cwd(), '.dev.vars'),          // From current directory
    path.join(process.cwd(), '../.dev.vars'),       // From current directory parent
    path.join(process.cwd(), '../../.dev.vars')     // From current directory grandparent
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
  maxAttempts: 3,
  requestHandler: {
    connectionTimeout: 30000,
    socketTimeout: 30000,
    maxSockets: 200, // Increase from default 50
  }
});

// Statistics
const stats = {
  totalFiles: 0,
  gzipFiles: 0,
  nonGzipFiles: 0,
  errors: 0,
  startTime: Date.now()
};

// Array to store gzip-encoded files
const gzipFiles = [];

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
      // Filter out .da-versions folders
      if (!prefixObj.Prefix.includes('/.da-versions/')) {
        subfolders.push(prefixObj.Prefix);
      }
    });
  }
  
  return subfolders;
}

// Function to process a folder and its subfolders recursively
async function processFolder(bucket, folderPrefix, batchSize = 50) {
  // List files in current folder only
  const objects = await listCurrentFolderObjects(bucket, folderPrefix);
  
  if (objects.length > 0) {
    // Process files in current folder immediately
    await processBatchImmediate(objects, batchSize);
    
    // Show progress
    process.stdout.write(`\rProcessed folder: ${folderPrefix} (${objects.length} files), ${stats.gzipFiles} gzip files detected...`);
  }
  
  // Discover subfolders
  const subfolders = await discoverSubfolders(bucket, folderPrefix);
  
  let totalObjectsInSubfolders = 0;
  
  if (subfolders.length > 0) {
    // Process subfolders with limited concurrency to avoid overwhelming connections
    const maxConcurrentSubfolders = 10;
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
async function processBatchImmediate(objects, batchSize = 50) {
  // Filter out objects in .da-versions folder
  const filteredObjects = objects.filter(obj => !obj.Key.includes('/.da-versions/'));
  
  for (let i = 0; i < filteredObjects.length; i += batchSize) {
    const batch = filteredObjects.slice(i, i + batchSize);
    const batchPromises = batch.map(obj => checkFileEncoding(bucket, obj.Key));
    await Promise.all(batchPromises);
  }
}

// Function to escape CSV field (handle commas and quotes)
function escapeCSV(field) {
  if (field === null || field === undefined) {
    return '';
  }
  const str = String(field);
  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Function to check if a file has gzip encoding
async function checkFileEncoding(bucket, key) {
  try {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const metadata = await s3Client.send(command);
    const contentEncoding = metadata.ContentEncoding || null;
    
    stats.totalFiles++;
    
    // Write all files to CSV with metadata
    if (allFilesStream) {
      const contentLength = metadata.ContentLength || 0;
      const lastModified = metadata.LastModified ? metadata.LastModified.toISOString() : '';
      // CSV format: path,contentLength,lastModified
      allFilesStream.write(`${escapeCSV(key)},${contentLength},${escapeCSV(lastModified)}\n`);
    }
    
    if (contentEncoding === 'gzip') {
      stats.gzipFiles++;
      gzipFiles.push({
        key: key,
        size: metadata.ContentLength,
        contentType: metadata.ContentType,
        lastModified: metadata.LastModified
      });
      
      // Write to gzip output file immediately
      if (outputStream) {
        outputStream.write(key + '\n');
      }
    } else {
      stats.nonGzipFiles++;
    }
    
    return contentEncoding === 'gzip';
  } catch (error) {
    stats.errors++;
    console.error(`Error checking ${key}: ${error.message}`);
    return false;
  }
}


// Main function
async function main() {
  console.log('='.repeat(60));
  console.log('S3 Gzip-Encoded Files Finder');
  console.log('='.repeat(60));
  console.log(`Bucket: ${bucket}`);
  console.log(`Prefix: ${prefix}`);
  console.log(`Gzip files output: ${outputFile}`);
  console.log(`All files output: ${allFilesOutput}`);
  console.log('');
  
  // Create output file streams
  outputStream = fs.createWriteStream(outputFile);
  outputStream.on('error', (err) => {
    console.error(`Error writing to ${outputFile}:`, err.message);
  });
  
  allFilesStream = fs.createWriteStream(allFilesOutput);
  allFilesStream.on('error', (err) => {
    console.error(`Error writing to ${allFilesOutput}:`, err.message);
  });
  
  // Write CSV header
  allFilesStream.write('FilePath,ContentLength,LastModified\n');
  
  try {
    // Process folder and subfolders recursively with parallel subfolder processing
    console.log('Scanning objects and checking ContentEncoding...');
    console.log('(Processing files in current folder, then parallelizing subfolders)');
    console.log('');
    
    const totalObjects = await processFolder(bucket, prefix, 25); // Conservative batch size to avoid connection limits
    
    console.log(''); // New line after progress
    
    if (totalObjects === 0) {
      console.log('No objects found with the specified prefix.');
      return;
    }
    
    // Display results
    console.log('');
    console.log('='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));
    console.log(`Total files checked: ${stats.totalFiles}`);
    console.log(`Gzip-encoded files: ${stats.gzipFiles}`);
    console.log(`Non-gzip files: ${stats.nonGzipFiles}`);
    console.log(`Errors: ${stats.errors}`);
    
    const duration = ((Date.now() - stats.startTime) / 1000).toFixed(2);
    console.log(`Duration: ${duration}s`);
    console.log('');
    
    if (gzipFiles.length > 0) {
      // console.log('='.repeat(60));
      // console.log('GZIP-ENCODED FILES');
      // console.log('='.repeat(60));
      
      // Sort by key for easier reading
      // gzipFiles.sort((a, b) => a.key.localeCompare(b.key));
      
      // gzipFiles.forEach((file, index) => {
      //   console.log(`${index + 1}. ${file.key}`);
      //   console.log(`   Size: ${formatBytes(file.size)}`);
      //   console.log(`   Type: ${file.contentType}`);
      //   console.log(`   Modified: ${file.lastModified.toISOString()}`);
      //   console.log('');
      // });
      
      // Also output a simple list for easy copying
      console.log('='.repeat(60));
      console.log('SIMPLE LIST (for batch processing)');
      console.log('='.repeat(60));
      gzipFiles.forEach(file => {
        console.log(`/${file.key}`);
      });
    } else {
      console.log('No gzip-encoded files found! ✓');
    }
    
    // Close output streams
    if (outputStream) {
      outputStream.end();
      console.log(`\nGzip files list written to: ${outputFile}`);
    }
    
    if (allFilesStream) {
      allFilesStream.end();
      console.log(`All files CSV written to: ${allFilesOutput} (with metadata: path, size, last modified)`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    if (outputStream) {
      outputStream.end();
    }
    if (allFilesStream) {
      allFilesStream.end();
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
