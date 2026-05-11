#!/usr/bin/env node
// Delete all objects under an S3 prefix using parallel sharded listing.
// Dry-run by default; pass -x to execute deletions.
//
// Usage: node delete-s3-folder.js [options] <folder-path>
//   -b, --bucket <bucket>  S3 bucket (default: aem-content)
//   -o, --org <org>        Organisation prefix prepended to folder path
//   -x, --execute          Execute deletions (default: dry run)

const { DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const {
  loadEnvVars,
  createS3Client,
  generateShardPrefixes,
  listShardObjects,
  formatShardLabel,
} = require('./traverse/s3-utils.js');

const BUCKET_DEFAULT = 'aem-content';
const SHARD_CONCURRENCY = 20;
const DELETE_BATCH_SIZE = 1000;
const DELETE_CONCURRENCY = 10;

function printUsage() {
  console.log('Usage: node delete-s3-folder.js [options] <folder-path>');
  console.log('  -b, --bucket <bucket>  S3 bucket name (default: aem-content)');
  console.log('  -o, --org <org>        Organisation prefix');
  console.log('  -x, --execute          Execute deletions (default: dry run)');
}

// Parse args
const rawArgs = process.argv.slice(2);
let bucket = BUCKET_DEFAULT;
let org = '';
let execute = false;
let folderPath = '';

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '-b' || a === '--bucket') { bucket = rawArgs[++i]; }
  else if (a === '-o' || a === '--org') { org = rawArgs[++i]; }
  else if (a === '-x' || a === '--execute') { execute = true; }
  else if (a === '-h' || a === '--help') { printUsage(); process.exit(0); }
  else if (!a.startsWith('-') && !folderPath) { folderPath = a; }
  else { console.error(`Unknown argument: ${a}`); printUsage(); process.exit(1); }
}

if (!folderPath) {
  console.error('Error: folder path is required');
  printUsage();
  process.exit(1);
}

let fullPrefix = org ? `${org}/${folderPath}` : folderPath;
if (!fullPrefix.endsWith('/')) fullPrefix += '/';

if (fullPrefix === '/') {
  console.error('Error: refusing to delete bucket root');
  process.exit(1);
}

async function main() {
  const { default: processQueue } = await import('@adobe/helix-shared-process-queue');

  const envVars = loadEnvVars();
  const s3Client = createS3Client(envVars);

  console.log('='.repeat(60));
  console.log('DA S3 Folder Delete');
  console.log('='.repeat(60));
  console.log(`Bucket: ${bucket}`);
  console.log(`Prefix: ${fullPrefix}`);
  console.log(`Mode:   ${execute ? 'EXECUTE — changes will be applied' : 'DRY RUN  — pass -x to execute'}`);
  console.log('');

  // Generate shards — expand .da-versions/ with hex shards if present under this prefix
  const shards = generateShardPrefixes(fullPrefix, 63, { expandPaths: ['.da-versions/'] });
  console.log(`Shards: ${shards.length} (concurrency: ${SHARD_CONCURRENCY})`);
  console.log('');

  const startTime = Date.now();

  // Phase 1: parallel sharded listing
  const allKeys = [];
  let shardIndex = 0;

  await processQueue(shards, async (shard) => {
    const i = shardIndex++;
    try {
      const count = await listShardObjects(s3Client, bucket, shard, fullPrefix, async (objects) => {
        for (const obj of objects) allKeys.push(obj.Key);
        process.stderr.write(`\r[INFO] Listed ${allKeys.length} objects so far...  `);
      });
      if (count > 0) {
        console.log(`✓ Shard ${i + 1} (${formatShardLabel(shard)}): ${count} objects`);
      }
    } catch (err) {
      console.error(`✗ Shard ${i + 1} (${formatShardLabel(shard)}): ${err.message}`);
    }
  }, SHARD_CONCURRENCY);

  process.stderr.write('\n');

  const total = allKeys.length;
  console.log('');
  console.log(`Found: ${total.toLocaleString()} object(s)`);

  if (total === 0) {
    console.log('[WARNING] No objects found — nothing to delete.');
    return;
  }

  if (!execute) {
    console.log('');
    console.log(`[DRY RUN] ${total.toLocaleString()} object(s) would be deleted. Re-run with -x to execute.`);
    return;
  }

  // Phase 2: parallel batch deletes
  console.log('');
  console.log(`Deleting ${total.toLocaleString()} object(s) in batches of ${DELETE_BATCH_SIZE} (concurrency: ${DELETE_CONCURRENCY})...`);

  const batches = [];
  for (let i = 0; i < allKeys.length; i += DELETE_BATCH_SIZE) {
    batches.push(allKeys.slice(i, i + DELETE_BATCH_SIZE));
  }

  let deleted = 0;
  let errors = 0;
  let batchIndex = 0;

  await processQueue(batches, async (batch) => {
    const idx = batchIndex++;
    const result = await s3Client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: batch.map((k) => ({ Key: k })),
        Quiet: true,
      },
    }));

    if (result.Errors && result.Errors.length > 0) {
      for (const err of result.Errors) {
        console.error(`[ERROR] ${err.Key}: ${err.Message}`);
      }
      errors += result.Errors.length;
      deleted += batch.length - result.Errors.length;
    } else {
      deleted += batch.length;
    }

    console.log(`Batch ${idx + 1}/${batches.length}: ${deleted.toLocaleString()}/${total.toLocaleString()} deleted`);
  }, DELETE_CONCURRENCY);

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('');
  console.log('='.repeat(60));
  if (errors === 0) {
    console.log(`[SUCCESS] Deleted ${deleted.toLocaleString()} object(s) in ${duration}s`);
  } else {
    console.log(`[WARNING] Deleted ${deleted.toLocaleString()} object(s), ${errors} error(s) in ${duration}s`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
