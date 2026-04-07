#!/usr/bin/env node
/**
 * List S3 folder contents with sharding for performance.
 *
 * Recursive mode shards the prefix (63 concurrent shards) for fast full listings.
 * Non-recursive mode uses delimiter-based pagination to get immediate children only.
 * Details mode includes size + last-modified; subfolder creation dates use parallel scans.
 *
 * Usage: node list-folder.js [OPTIONS] <folder-path>
 */

const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
const fs = require('fs');
const {
  loadEnvVars,
  createS3Client,
  listShardObjects,
  generateShardPrefixes,
  filterObjectsByShard,
  formatShardLabel,
} = require('./s3-utils.js');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function showUsage() {
  console.error('Usage: node list-folder.js [OPTIONS] <folder-path>');
  console.error('');
  console.error('Options:');
  console.error('  -b, --bucket <bucket>     S3 bucket name (default: aem-content)');
  console.error('  -o, --org <org>           Organization prefix');
  console.error('  -r, --recursive           Recursive listing (sharded, parallel)');
  console.error('  -d, --details             Show size + last-modified; creation date for subfolders');
  console.error('  -f, --output-file <file>  Save listing to file');
  console.error('  -h, --help                Show this help');
  console.error('');
  console.error('Examples:');
  console.error('  node list-folder.js /');
  console.error('  node list-folder.js -o myorg documents/');
  console.error('  node list-folder.js -r assets/');
  console.error('  node list-folder.js -d -f out.txt images/');
}

let bucket = 'aem-content';
let org = '';
let recursive = false;
let details = false;
let outputFile = '';
let folderArg = null;

const argv = process.argv.slice(2);

if (argv.length === 0) {
  console.error('Missing required argument: folder path (use / for root)');
  showUsage();
  process.exit(1);
}

for (let i = 0; i < argv.length; i++) {
  switch (argv[i]) {
    case '-b': case '--bucket':      bucket = argv[++i]; break;
    case '-o': case '--org':         org = argv[++i]; break;
    case '-r': case '--recursive':   recursive = true; break;
    case '-d': case '--details':     details = true; break;
    case '-f': case '--output-file': outputFile = argv[++i]; break;
    case '-h': case '--help':        showUsage(); process.exit(0); break;
    default:
      if (argv[i].startsWith('-')) {
        console.error(`Unknown option: ${argv[i]}`);
        showUsage();
        process.exit(1);
      }
      folderArg = argv[i];
  }
}

// Normalize prefix
let prefix = (folderArg === '/' || folderArg === '.' || folderArg === null) ? '' : folderArg;
if (org) prefix = `${org}/${prefix}`;
if (prefix && !prefix.endsWith('/')) prefix += '/';

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

let outStream = null;
if (outputFile) outStream = fs.createWriteStream(outputFile);

function write(line) {
  console.log(line);
  if (outStream) outStream.write(line + '\n');
}

// ---------------------------------------------------------------------------
// Core S3 helpers
// ---------------------------------------------------------------------------

/**
 * Paginate ListObjectsV2 with Delimiter='/' to get immediate files + subfolder prefixes.
 */
async function listImmediate(pfx) {
  const files = [];
  const subfolders = [];
  let token = null;
  do {
    const resp = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: pfx,
      Delimiter: '/',
      MaxKeys: 1000,
      ContinuationToken: token,
    }));
    for (const obj of resp.Contents || []) files.push(obj);
    for (const cp of resp.CommonPrefixes || []) subfolders.push(cp.Prefix);
    token = resp.NextContinuationToken;
  } while (token);
  return { files, subfolders };
}

/**
 * List all objects under prefix using sharding (63 concurrent shard queries).
 * Calls onBatch for each batch of objects returned by a shard page.
 */
async function listRecursiveSharded(pfx, onBatch, processQueue) {
  const shards = generateShardPrefixes(pfx, 63, { expandPaths: ['.da-versions/'] });
  let total = 0;
  await processQueue(shards, async (shard) => {
    const count = await listShardObjects(s3Client, bucket, shard, pfx, onBatch);
    total += count;
  }, 63);
  return total;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatFileRow(obj) {
  if (details) {
    const size = String(obj.Size || 0).padStart(12);
    const modified = obj.LastModified ? obj.LastModified.toISOString() : 'unknown             ';
    return `${size}  ${modified}  ${obj.Key}`;
  }
  return obj.Key;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let s3Client;

async function main() {
  const envVars = loadEnvVars();
  s3Client = createS3Client(envVars);

  const { default: processQueue } = await import('@adobe/helix-shared-process-queue');

  console.log(`Bucket:    ${bucket}`);
  console.log(`Prefix:    ${prefix || '(root)'}`);
  console.log(`Recursive: ${recursive}`);
  console.log(`Details:   ${details}`);
  console.log('');

  const startTime = Date.now();
  let totalFiles = 0;

  if (recursive) {
    if (details) write('        Size  LastModified              Key');
    totalFiles = await listRecursiveSharded(prefix, async (objects) => {
      for (const obj of objects) {
        write(formatFileRow(obj));
        totalFiles++;
      }
    }, processQueue);
  } else {
    const { files, subfolders } = await listImmediate(prefix);
    totalFiles = files.length;

    if (details && files.length > 0) write('        Size  LastModified              Key');
    for (const obj of files) write(formatFileRow(obj));

    write('');
    write('Subfolders:');

    if (subfolders.length === 0) {
      write('  (none)');
    } else if (details) {
      for (const sf of subfolders) write(sf);
    } else {
      for (const sf of subfolders) write(sf);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  write('');
  write(`Total files: ${totalFiles}`);
  write(`Duration:    ${elapsed}s`);
  if (outputFile) write(`Output:      ${outputFile}`);

  if (outStream) outStream.end();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
