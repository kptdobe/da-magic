#!/usr/bin/env node
// Export all keys and values from a Cloudflare KV namespace
// Usage: node cloudflare-kv-export.js [output-file]
// Example: node cloudflare-kv-export.js kv-export.json

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
if (process.argv.length < 3) {
  console.error('Usage: node cloudflare-kv-export.js <namespace-id> [output-file] [ignore-slashes]');
  console.error('Example: node cloudflare-kv-export.js abc123def456');
  console.error('Example: node cloudflare-kv-export.js abc123def456 my-export.json');
  console.error('Example: node cloudflare-kv-export.js abc123def456 my-export.json true');
  process.exit(1);
}

const namespaceId = process.argv[2];
const outputFile = process.argv[3] || 'kv-export.json';
const ignoreSlashes = process.argv[4] === 'true';

// Load environment variables from .dev.vars
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

// Validate required environment variables
function validateEnvVars(envVars) {
  const required = ['CF_ACCOUNT_ID', 'CF_API_TOKEN'];
  const missing = required.filter(key => !envVars[key]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables in .dev.vars:');
    missing.forEach(key => console.error(`  - ${key}`));
    console.error('\nAdd these to your .dev.vars file:');
    console.error('  CF_ACCOUNT_ID=your-account-id');
    console.error('  CF_API_TOKEN=your-api-token');
    process.exit(1);
  }
}

// List all keys in the KV namespace (paginated)
async function listAllKeys(accountId, namespaceId, apiToken, ignoreSlashes = false) {
  const allKeys = [];
  let cursor = null;
  let pageCount = 0;
  
  console.log(`Listing all keys${ignoreSlashes ? ' (ignoring keys with slashes)' : ''}...`);
  
  do {
    pageCount++;
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys` +
      (cursor ? `?cursor=${cursor}` : '?limit=1000');
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list keys: ${response.status} ${response.statusText}\n${errorText}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(`API error: ${JSON.stringify(data.errors)}`);
    }
    
    let keys = data.result || [];
    
    // Filter out keys with slashes if requested
    if (ignoreSlashes) {
      const originalCount = keys.length;
      keys = keys.filter(k => !k.name.includes('/'));
      // Optional: Log how many were filtered if you want verbose output
    }
    
    allKeys.push(...keys);
    
    process.stdout.write(`\rPage ${pageCount}: ${allKeys.length} keys found...`);
    
    // Get cursor for next page
    cursor = data.result_info?.cursor || null;
    
  } while (cursor);
  
  console.log(`\nTotal keys found: ${allKeys.length}`);
  return allKeys;
}

// Fetch a single key's value
async function fetchKeyValue(accountId, namespaceId, apiToken, keyName) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(keyName)}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiToken}`
    }
  });
  
  if (!response.ok) {
    if (response.status === 404) {
      return null; // Key was deleted between list and fetch
    }
    
    // Throw error object with status and headers for retry logic
    const error = new Error(`Failed to fetch key "${keyName}": ${response.status} ${response.statusText}`);
    error.status = response.status;
    error.headers = response.headers;
    throw error;
  }
  
  // KV values are returned as raw response body
  const value = await response.text();
  return value;
}

// Delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch all values in parallel batches with rate limiting
async function fetchAllValues(accountId, namespaceId, apiToken, keys, batchSize = 5, delayMs = 100) {
  const results = [];
  const stats = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    retries: 0,
    startTime: Date.now()
  };
  
  console.log(`\nFetching ${keys.length} values (${batchSize} concurrent, ${delayMs}ms delay between batches)...`);
  
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (keyInfo) => {
      // Retry logic for 429 errors
      let retries = 0;
      const maxRetries = 10; // Increased to 10 for high resilience
      
      while (retries <= maxRetries) {
        try {
          const value = await fetchKeyValue(accountId, namespaceId, apiToken, keyInfo.name);
          stats.succeeded++;
          
          // Try to parse as JSON, otherwise keep as string
          let parsedValue = value;
          try {
            parsedValue = JSON.parse(value);
          } catch (e) {
            // Keep as string
          }
          
          return {
            key: keyInfo.name,
            value: parsedValue,
            metadata: keyInfo.metadata || null,
            expiration: keyInfo.expiration || null,
            success: true
          };
        } catch (error) {
          // Retry on 429 (Too Many Requests) OR 5xx (Server Errors)
          const status = error.status || 500;
          const shouldRetry = status === 429 || (status >= 500 && status < 600);
          
          if (shouldRetry && retries < maxRetries) {
            // Rate limited - wait and retry
            retries++;
            stats.retries++;
            
            let waitTime;
            
            // Check for Retry-After header
            const retryAfter = error.headers ? error.headers.get('retry-after') : null;
            
            if (retryAfter) {
              // Retry-After can be seconds or a date, usually seconds for 429
              waitTime = (parseInt(retryAfter, 10) * 1000) + 100; // Add 100ms buffer
              // console.log(`\nRate limited. Waiting ${waitTime/1000}s (Retry-After header)...`);
            } else {
              // Fallback to exponential backoff
              // Backoff: 1s, 2s, 4s, 8s, 16s... capped at 30s
              const backoffTime = Math.min(Math.pow(2, retries) * 1000, 30000);
              const jitter = Math.random() * 1000;
              waitTime = backoffTime + jitter;
            }
            
            await delay(waitTime);
            continue;
          }
          
          // If we exhausted retries or it's a non-retryable error
          stats.failed++;
          console.error(`\nError fetching key "${keyInfo.name}": ${error.message}`);
          return {
            key: keyInfo.name,
            error: error.message,
            success: false
          };
        }
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    stats.processed += batch.length;
    const progress = ((stats.processed / keys.length) * 100).toFixed(1);
    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    process.stdout.write(`\rProgress: ${stats.processed}/${keys.length} (${progress}%) | Elapsed: ${elapsed}s | Success: ${stats.succeeded} | Failed: ${stats.failed} | Retries: ${stats.retries}  `);
    
    // Delay between batches to respect rate limits
    if (i + batchSize < keys.length) {
      await delay(delayMs);
    }
  }
  
  console.log('\n');
  return { results, stats };
}

// Main function
async function main() {
  console.log('='.repeat(70));
  console.log('Cloudflare KV Export');
  console.log('='.repeat(70));
  
  try {
    // Load and validate environment
    const envVars = loadEnvVars();
    validateEnvVars(envVars);
    
    const accountId = envVars.CF_ACCOUNT_ID;
    const apiToken = envVars.CF_API_TOKEN;
    
    console.log(`Account ID: ${accountId}`);
    console.log(`Namespace ID: ${namespaceId}`);
    console.log(`Output file: ${outputFile}`);
    console.log(`Ignore slashes: ${ignoreSlashes}`);
    console.log('');
    
    // Step 1: List all keys
    const keys = await listAllKeys(accountId, namespaceId, apiToken, ignoreSlashes);
    
    if (keys.length === 0) {
      console.log('No keys found in namespace.');
      
      // Write empty export
      const exportData = {
        namespace_id: namespaceId,
        account_id: accountId,
        exported_at: new Date().toISOString(),
        total_keys: 0,
        data: []
      };
      
      fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2));
      console.log(`Empty export written to: ${outputFile}`);
      return;
    }
    
    // Step 2: Fetch all values
    const { results, stats } = await fetchAllValues(accountId, namespaceId, apiToken, keys);
    
    // Step 3: Write to file
    console.log('Writing export file...');
    
    // Separate successful data from failures
    const successfulData = results.filter(r => r.success).map(r => {
      const { success, ...data } = r;
      return data;
    });
    
    const failedData = results.filter(r => !r.success).map(r => {
      const { success, ...data } = r;
      return data;
    });
    
    const exportData = {
      namespace_id: namespaceId,
      account_id: accountId,
      exported_at: new Date().toISOString(),
      total_keys: keys.length,
      successful_exports: stats.succeeded,
      failed_exports: stats.failed,
      data: successfulData,
      failures: failedData.length > 0 ? failedData : undefined
    };
    
    fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2));
    
    // Summary
    console.log('');
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total keys: ${keys.length}`);
    console.log(`Successfully exported: ${stats.succeeded}`);
    console.log(`Failed exports: ${stats.failed}`);
    console.log(`Retries due to rate limits: ${stats.retries}`);
    
    if (stats.failed > 0) {
      console.log('');
      console.log('⚠️  WARNING: Some keys failed to export even after retries.');
      console.log('Check the "failures" array in the output file.');
      process.exitCode = 1; // Exit with error code but save partial data
    }
    
    const duration = ((Date.now() - stats.startTime) / 1000).toFixed(2);
    console.log(`Duration: ${duration}s`);
    
    const keysPerSecond = (keys.length / (duration || 1)).toFixed(0);
    console.log(`Throughput: ${keysPerSecond} keys/second`);
    
    console.log('');
    console.log(`Export saved to: ${outputFile}`);
    
    if (stats.succeeded > 0) {
      // Show file size
      const fileStats = fs.statSync(outputFile);
      const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
      console.log(`File size: ${fileSizeMB} MB`);
    }
    
    console.log('');
    console.log('✓ Export complete!');
    
  } catch (error) {
    console.error('\nError:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

