#!/usr/bin/env node
// Helper script to check ContentEncoding using Node.js AWS SDK
// Usage: node check-encoding-node.js <bucket> <key>

const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

if (process.argv.length < 4) {
  console.error('Usage: node check-encoding-node.js <bucket> <key>');
  process.exit(1);
}

const bucket = process.argv[2];
const key = process.argv[3];

// Load environment variables from .dev.vars
const loadEnvVars = () => {
  const envPath = path.join(__dirname, '../../.dev.vars');
  if (!fs.existsSync(envPath)) {
    throw new Error('.dev.vars file not found');
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

const s3Client = new S3Client({
  credentials: {
    accessKeyId: envVars.S3_ACCESS_KEY_ID,
    secretAccessKey: envVars.S3_SECRET_ACCESS_KEY,
  },
  endpoint: envVars.S3_DEF_URL,
  forcePathStyle: true,
  region: 'auto'
});

async function checkEncoding() {
  try {
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const metadata = await s3Client.send(headCommand);
    
    // Output in a format easy to parse in bash
    const contentEncoding = metadata.ContentEncoding || 'None';
    const contentType = metadata.ContentType || 'application/octet-stream';
    
    console.log(JSON.stringify({
      ContentEncoding: contentEncoding,
      ContentType: contentType,
      Metadata: metadata.Metadata || {}
    }));
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkEncoding();
