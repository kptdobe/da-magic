#!/usr/bin/env node
// Traverse S3 for HTML and JSON objects and extract all href and src attribute values.
// Output: TSV (path\turl) written progressively to urls.tsv.
// Uses traverse s3-utils (sharding, parallel listing) like traverse.sh / find-hlx-ref.js.
// Usage: node find-urls.js <prefix> [output-file]
// Example: node find-urls.js cmegroup/www/drafts urls.tsv

const { ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const {
  loadEnvVars,
  createS3Client,
  generateShardPrefixes,
  filterObjectsByShard,
  displayShardInfo,
  formatShardLabel
} = require('../traverse/s3-utils.js');

if (process.argv.length < 3) {
  console.error('Usage: node find-urls.js <prefix> [output-file]');
  console.error('  prefix       - S3 prefix to traverse (e.g. cmegroup/www/drafts)');
  console.error('  output-file  - TSV output (default: urls.tsv)');
  process.exit(1);
}

const bucket = 'aem-content';
let prefix = process.argv[2];
if (prefix.startsWith('/')) {
  prefix = prefix.substring(1);
}
const outputFile = process.argv[3] || 'urls.tsv';
const shardCount = 63;

let outputStream = null;

// Match href="..." or href='...' and src="..." or src='...'
const HREF_SRC_REGEX = /(?:href|src)\s*=\s*["']([^"']*)["']/gi;

function shouldProcessFile(key) {
  if (key.includes('/.da-versions/') || key.includes('/.trash/')) {
    return false;
  }
  const lower = key.toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.json');
}

function extractHrefSrc(content) {
  const urls = [];
  let m;
  HREF_SRC_REGEX.lastIndex = 0;
  while ((m = HREF_SRC_REGEX.exec(content)) !== null) {
    urls.push(m[1].trim());
  }
  return urls;
}

async function fetchAndExtractUrls(key) {
  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key
    }));
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString('utf-8');
    const urls = extractHrefSrc(content);
    return { key, urls };
  } catch (err) {
    console.error(`✗ Error reading ${key}: ${err.message}`);
    return { key, urls: [] };
  }
}

async function listAndProcessShard(shard, shardId) {
  stats.totalShards++;
  stats.activeShards++;

  let continuationToken = null;
  let shardFileCount = 0;
  let shardUrlCount = 0;
  const startTime = Date.now();
  const shardPrefix = shard.prefix;
  const filesToProcess = [];

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
        const keysToProcess = filterObjectsByShard(response.Contents, shard, prefix);
        const processable = keysToProcess.filter(obj => shouldProcessFile(obj.Key));
        shardFileCount += processable.length;
        stats.totalFiles += processable.length;
        filesToProcess.push(...processable);
      }

      continuationToken = response.NextContinuationToken;

      if (Date.now() - stats.lastUpdate > 10000) {
        const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
        console.log(`[${elapsed}s] Total: ${stats.totalFiles} files | URLs: ${stats.totalUrls} | Active: ${stats.activeShards} | Completed: ${stats.completedShards}/${stats.totalShards}`);
        stats.lastUpdate = Date.now();
      }
    } while (continuationToken);

    if (filesToProcess.length > 0) {
      const batchSize = 5;
      for (let i = 0; i < filesToProcess.length; i += batchSize) {
        const batch = filesToProcess.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(obj => fetchAndExtractUrls(obj.Key))
        );
        for (const { key, urls } of results) {
          for (const url of urls) {
            outputStream.write(`${key}\t${url}\n`);
            shardUrlCount++;
            stats.totalUrls++;
          }
        }
      }
    }

    stats.completedShards++;
    stats.activeShards--;

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const shardLabel = formatShardLabel(shard);
    console.log(`✓ Shard ${shardId} (${shardLabel}): ${shardFileCount} files, ${shardUrlCount} URLs in ${duration}s`);

    return shardFileCount;
  } catch (error) {
    stats.activeShards--;
    const shardLabel = formatShardLabel(shard);
    console.error(`✗ Shard ${shardId} (${shardLabel}) failed: ${error.message}`);
    return 0;
  }
}

const envVars = loadEnvVars();
const s3Client = createS3Client(envVars);

const stats = {
  totalFiles: 0,
  totalUrls: 0,
  totalShards: 0,
  completedShards: 0,
  activeShards: 0,
  startTime: Date.now(),
  lastUpdate: Date.now()
};

async function main() {
  console.log('='.repeat(70));
  console.log('S3 URL extractor (href / src)');
  console.log('='.repeat(70));
  console.log(`Bucket: ${bucket}`);
  console.log(`Prefix: ${prefix}`);
  console.log(`Output: ${outputFile}`);
  console.log(`Shards: 63 concurrent`);
  console.log('');

  outputStream = fs.createWriteStream(outputFile);
  outputStream.on('error', (err) => {
    console.error(`Error writing ${outputFile}:`, err.message);
  });

  try {
    const shards = generateShardPrefixes(prefix, shardCount);
    displayShardInfo(shards);

    console.log('');
    console.log('Starting...');
    console.log('');

    stats.startTime = Date.now();
    stats.lastUpdate = Date.now();

    const shardPromises = shards.map((shard, index) =>
      listAndProcessShard(shard, index + 1)
    );

    await Promise.all(shardPromises);

    outputStream.end();

    console.log('');
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Files: ${stats.totalFiles.toLocaleString()}`);
    console.log(`URLs:  ${stats.totalUrls.toLocaleString()}`);
    const duration = ((Date.now() - stats.startTime) / 1000).toFixed(2);
    console.log(`Time:  ${duration}s`);
    console.log(`Output: ${outputFile}`);
    console.log('');
  } catch (error) {
    console.error('Error:', error.message);
    if (outputStream) outputStream.end();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
