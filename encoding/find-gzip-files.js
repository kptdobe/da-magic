#!/usr/bin/env node
// Find all files with gzip ContentEncoding in S3 bucket
// Usage: node find-gzip-files.js <prefix> [output-file]
// Example: node find-gzip-files.js cmegroup/www/drafts
// Example: node find-gzip-files.js cmegroup/www/drafts my-gzip-files.txt
// Note: Automatically ignores .da-versions folders

const { S3Client, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
if (process.argv.length < 3) {
  console.error('Usage: node find-gzip-files.js <prefix> [output-file]');
  console.error('Example: node find-gzip-files.js cmegroup/www/drafts');
  console.error('Example: node find-gzip-files.js cmegroup/www/drafts my-gzip-files.txt');
  process.exit(1);
}

const bucket = 'aem-content';  // Hardcoded bucket name
const prefix = process.argv[2];
const outputFile = process.argv[3] || 'list.txt';

// Create file stream for progressive output
let outputStream = null;

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

// Configure S3 client
const s3Client = new S3Client({
  credentials: {
    accessKeyId: envVars.S3_ACCESS_KEY_ID,
    secretAccessKey: envVars.S3_SECRET_ACCESS_KEY,
  },
  endpoint: envVars.S3_DEF_URL,
  forcePathStyle: true,
  region: 'auto'
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

// Function to list objects and process them in parallel as they come in
async function listAndProcessObjects(bucket, prefix, batchSize = 50) {
  let continuationToken = null;
  let totalListed = 0;
  const processingPromises = [];
  
  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000 // Request maximum keys per page for efficiency
    });
    
    const response = await s3Client.send(command);
    
    if (response.Contents && response.Contents.length > 0) {
      totalListed += response.Contents.length;
      
      // Process this batch immediately in parallel while we fetch the next page
      // Note: .da-versions folders are automatically filtered out
      const batchPromise = processBatchImmediate(response.Contents, batchSize);
      processingPromises.push(batchPromise);
      
      // Show progress
      process.stdout.write(`\rListing: ${totalListed} objects found, ${stats.gzipFiles} gzip files detected...`);
    }
    
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  
  // Wait for all processing to complete
  await Promise.all(processingPromises);
  
  console.log(''); // New line after progress
  return totalListed;
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
    
    if (contentEncoding === 'gzip') {
      stats.gzipFiles++;
      gzipFiles.push({
        key: key,
        size: metadata.ContentLength,
        contentType: metadata.ContentType,
        lastModified: metadata.LastModified
      });
      
      // Write to output file immediately
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
  console.log(`Output file: ${outputFile}`);
  console.log('');
  
  // Create output file stream
  outputStream = fs.createWriteStream(outputFile);
  outputStream.on('error', (err) => {
    console.error(`Error writing to ${outputFile}:`, err.message);
  });
  
  try {
    // List and process objects in parallel (streaming approach)
    console.log('Scanning objects and checking ContentEncoding...');
    console.log('(Processing files as they are discovered for maximum speed)');
    console.log('');
    
    const totalObjects = await listAndProcessObjects(bucket, prefix, 100); // Increased batch size to 100
    
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
      console.log('='.repeat(60));
      console.log('GZIP-ENCODED FILES');
      console.log('='.repeat(60));
      
      // Sort by key for easier reading
      gzipFiles.sort((a, b) => a.key.localeCompare(b.key));
      
      gzipFiles.forEach((file, index) => {
        console.log(`${index + 1}. ${file.key}`);
        console.log(`   Size: ${formatBytes(file.size)}`);
        console.log(`   Type: ${file.contentType}`);
        console.log(`   Modified: ${file.lastModified.toISOString()}`);
        console.log('');
      });
      
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
    
    // Close output stream
    if (outputStream) {
      outputStream.end();
      console.log(`\nFile list written to: ${outputFile}`);
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
