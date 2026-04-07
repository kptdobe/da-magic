# da-magic Project Standards

## S3 Traversal — Always Use Sharding

Any operation that lists or traverses S3 objects under a prefix **must** use sharding via `traverse/s3-utils.js` and `traverse/sharding.js`. Never use serial `aws` CLI pagination or a single `ListObjectsV2` loop for full-prefix traversal.

Pattern:
- Use `generateShardPrefixes(prefix, 63, { expandPaths: ['.da-versions/'] })` for standard org/repo prefixes.
- Use `generateHexShardPrefixes(prefix)` when the keys are UUID/hex-keyed (e.g. `.da-versions/` direct traversal).
- Pass shards to `listShardObjects` and process them with `processQueue` (not `Promise.all`) to respect concurrency limits.
- For per-object work inside a shard, use `@adobe/helix-shared-process-queue` to control concurrency.

Non-recursive delimiter-based listing (immediate children only) is the one exception — `ListObjectsV2` with `Delimiter: '/'` is correct there since sharding and delimiters are incompatible.
Reference implementations: `traverse/traverse.js`, `traverse/list-folder.js`, `traverse/version-cleaner.js`.

## Dry Run by Default

Any script or tool that performs **write, delete, or mutating** S3 (or other) operations must:

- Default to **dry run** mode: log what would be done but make no changes.
- Require an explicit `-x` flag to execute real operations.
- Print a clear banner at startup indicating the current mode, e.g.:
  ```
  Mode: DRY RUN (pass -x to execute)
  ```
  or
  ```
  Mode: EXECUTE — changes will be applied
  ```

Read-only operations (list, get, head) are not affected by this rule.

Reference implementation: `traverse/version-cleaner.js`.
