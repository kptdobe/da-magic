#!/usr/bin/env node
// Find all files with gzip ContentEncoding in S3 bucket
// Usage: node find-gzip-files.js <prefix>
// Example: node find-gzip-files.js cmegroup/www/drafts

const { S3Client, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
if (process.argv.length < 3) {
  console.error('Usage: node find-gzip-files.js <prefix>');
  console.error('Example: node find-gzip-files.js cmegroup/www/drafts');
  process.exit(1);
}

const bucket = 'aem-content';  // Hardcoded bucket name
const prefix = process.argv[2];

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

// Function to list all objects in a bucket with a prefix (handles pagination)
async function listAllObjects(bucket, prefix) {
  const allObjects = [];
  let continuationToken = null;
  
  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken
    });
    
    const response = await s3Client.send(command);
    
    if (response.Contents) {
      allObjects.push(...response.Contents);
    }
    
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  
  return allObjects;
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

// Function to process files in batches with concurrency limit
async function processBatch(objects, batchSize = 50) {
  const results = [];
  
  for (let i = 0; i < objects.length; i += batchSize) {
    const batch = objects.slice(i, i + batchSize);
    const batchPromises = batch.map(obj => checkFileEncoding(bucket, obj.Key));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Progress indicator
    const progress = Math.min(i + batchSize, objects.length);
    const percentage = ((progress / objects.length) * 100).toFixed(1);
    process.stdout.write(`\rProgress: ${progress}/${objects.length} (${percentage}%) - Found ${stats.gzipFiles} gzip files`);
  }
  
  console.log(''); // New line after progress
  return results;
}

// Main function
async function main() {
  console.log('='.repeat(60));
  console.log('S3 Gzip-Encoded Files Finder');
  console.log('='.repeat(60));
  console.log(`Bucket: ${bucket}`);
  console.log(`Prefix: ${prefix}`);
  console.log('');
  
  try {
    // Step 1: List all objects
    console.log('Step 1: Listing all objects...');
    const objects = await listAllObjects(bucket, prefix);
    console.log(`Found ${objects.length} objects`);
    console.log('');
    
    if (objects.length === 0) {
      console.log('No objects found with the specified prefix.');
      return;
    }
    
    // Step 2: Check each object's encoding in parallel batches
    console.log('Step 2: Checking ContentEncoding for each file...');
    await processBatch(objects);
    
    // Step 3: Display results
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
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
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
