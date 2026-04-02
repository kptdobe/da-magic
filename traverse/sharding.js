/**
 * S3 Key Sharding Logic
 * 
 * Generates shard prefixes for parallel S3 listing operations.
 * Handles all alphanumeric characters (0-9, a-z, A-Z) and special characters.
 */

/**
 * Generate shard prefixes for S3 key distribution
 * 
 * IMPORTANT: For complete coverage, this ALWAYS generates 63 shards
 * (1 catch-all + 62 alphanumeric), regardless of count parameter.
 * This is because S3 prefix matching is literal - we can't use patterns.
 * 
 * @param {string} basePrefix - The base S3 prefix to shard
 * @param {number} count - Requested number of shards (ignored for now, always returns 63)
 * @returns {Array<{prefix: string, type: string, description: string, charRange: Array}>} Array of shard configurations (always 63)
 */
/**
 * Generate shard prefixes for S3 key distribution.
 *
 * @param {string} basePrefix - The base S3 prefix to shard
 * @param {number} count - Requested number of shards (ignored, always returns full set)
 * @param {Object} [options]
 * @param {string[]} [options.expandPaths=['.da-versions/']] - Sub-paths to expand with hex shards
 *   instead of covering with a single char shard. Each entry must be a full sub-path relative to
 *   basePrefix (e.g. '.da-versions/'). When the prefix of a shard matches one of these paths,
 *   it is replaced with 256 two-char hex sub-shards.
 * @returns {Array} Array of shard configurations
 */
function generateShardPrefixes(basePrefix, count, { expandPaths = [] } = {}) {
  if (count === 1) {
    return [{
      prefix: basePrefix,
      type: 'all',
      description: 'All files',
      charRange: null
    }];
  }

  const shards = [];

  // All characters to shard on — no catch-all, every known char gets its own focused S3 query.
  // Alphanum + special chars observed in real S3 key data.
  const digits = '0123456789';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const specialChars = `_-.@$%'(,;[~`;

  const allChars = digits + uppercase + lowercase + specialChars;

  // Build a set of expanded sub-paths for quick lookup
  const expandSet = new Set((expandPaths || []).map(p => basePrefix + p));

  // Generate one shard per character.
  // If a char leads to a known heavy sub-path (e.g. .da-versions/), expand it into
  // 256 hex sub-shards instead — no catch-all full scan needed.
  for (const char of allChars) {
    const shardPrefix = basePrefix + char;

    const matchingExpandPath = [...expandSet].find(p => p.startsWith(shardPrefix));
    if (matchingExpandPath) {
      const hexChars = '0123456789abcdef';
      for (const hi of hexChars) {
        for (const lo of hexChars) {
          shards.push({
            prefix: matchingExpandPath + hi + lo,
            type: 'hex',
            description: `Hex-expanded: '${matchingExpandPath}${hi}${lo}'`,
            charRange: [hi, lo],
            expandedFrom: shardPrefix
          });
        }
      }
      continue;
    }

    shards.push({
      prefix: shardPrefix,
      type: 'explicit',
      description: `Files starting with '${char}'`,
      charRange: [char]
    });
  }

  return shards;
}

/**
 * Check if a key should be processed by a specific shard
 * 
 * @param {string} key - The S3 key to check
 * @param {object} shard - The shard configuration
 * @param {string} basePrefix - The base prefix before sharding
 * @returns {boolean} True if the key belongs to this shard
 */
function keyBelongsToShard(key, shard, basePrefix) {
  // Key must start with the base prefix
  if (!key.startsWith(basePrefix)) {
    return false;
  }
  
  const keyAfterPrefix = key.substring(basePrefix.length);
  
  // Empty key after prefix shouldn't happen but handle it
  if (!keyAfterPrefix) {
    return shard.type === 'catch-all' || shard.type === 'all';
  }
  
  const firstChar = keyAfterPrefix[0];
  
  // For "all" type, accept everything
  if (shard.type === 'all') {
    return true;
  }
  
  // Explicit shards (alphanum + _ - .)
  if (shard.type === 'explicit' || shard.type === 'alphanum') {
    if (shard.charRange) {
      return shard.charRange.includes(firstChar);
    }
    return key.startsWith(shard.prefix);
  }

  // For catch-all shard, accept only what's NOT covered by explicit shards
  // Explicit chars: 0-9, a-z, A-Z, _, -, .
  if (shard.type === 'catch-all') {
    return !/[0-9a-zA-Z_.-]/.test(firstChar);
  }
  
  return false;
}

/**
 * Generate 2-character hex shard prefixes for parallel S3 listing of UUID-keyed paths.
 * Produces 256 shards (00-ff). Optionally adds explicit shards for extra characters
 * (e.g. '.', '_', '-', '@') — each gets its own S3 query, no catch-all full scan.
 *
 * @param {string} basePrefix - The base S3 prefix to shard (e.g. "org/.da-versions/")
 * @param {Object} [options]
 * @param {string[]} [options.extraChars=[]] - Extra first-char prefixes to add explicit shards for
 * @returns {Array<{prefix: string, type: string, description: string, charRange: Array}>}
 */
function generateHexShardPrefixes(basePrefix, { extraChars = [] } = {}) {
  const shards = [];
  const hexChars = '0123456789abcdef';

  // 256 two-character hex shards: 00, 01, ..., ff
  for (const hi of hexChars) {
    for (const lo of hexChars) {
      const twoChar = hi + lo;
      shards.push({
        prefix: basePrefix + twoChar,
        type: 'hex',
        description: `Files starting with '${twoChar}'`,
        charRange: [hi, lo]
      });
    }
  }

  // Explicit shards for extra characters — each triggers its own focused S3 query
  for (const char of extraChars) {
    shards.push({
      prefix: basePrefix + char,
      type: 'explicit',
      description: `Files starting with '${char}'`,
      charRange: [char]
    });
  }

  return shards;
}

/**
 * Filter S3 objects by shard to avoid duplicates between overlapping prefixes
 *
 * @param {Array} objects - Array of S3 objects from ListObjectsV2
 * @param {object} shard - The shard configuration
 * @param {string} basePrefix - The base prefix before sharding
 * @returns {Array} Filtered array of objects that belong to this shard
 */
function filterObjectsByShard(objects, shard, basePrefix) {
  if (!objects || objects.length === 0) {
    return [];
  }

  // hex shards: S3 prefix is exact 2-char match, no client-side filter needed
  if (shard.type === 'hex') {
    return objects;
  }

  // catch-all for hex mode: keep only objects NOT starting with 2 hex chars
  if (shard.type === 'catch-all-hex') {
    return objects.filter(obj => {
      const keyAfterPrefix = obj.Key.substring(basePrefix.length);
      if (!keyAfterPrefix) return true;
      return !/^[0-9a-f]{2}/i.test(keyAfterPrefix);
    });
  }

  // For specific shards, all returned objects should belong to it
  // (S3 prefix filtering already did the work)
  return objects;
}

/**
 * Get statistics about shard distribution
 *
 * @param {Array} shards - Array of shard configurations
 * @returns {object} Statistics about the shards
 */
function getShardStats(shards) {
  const stats = {
    total: shards.length,
    'catch-all': 0,
    alphanum: 0, // Kept for compatibility (includes explicit)
    explicit: 0,
    hex: 0,
    all: 0,
    catchAll: 0, // Alias for backward compat
    characters: []
  };

  shards.forEach(shard => {
    if (shard.type === 'catch-all-hex') {
      stats['catch-all']++;
      stats.catchAll++;
    } else if (shard.type === 'alphanum' || shard.type === 'explicit') {
      stats.alphanum++;
      stats.explicit++;
      if (shard.charRange) {
        stats.characters.push(...shard.charRange);
      }
    } else if (shard.type === 'hex') {
      stats.hex++;
    } else if (shard.type === 'all') {
      stats.all++;
    }
  });

  return stats;
}

module.exports = {
  generateShardPrefixes,
  generateHexShardPrefixes,
  keyBelongsToShard,
  filterObjectsByShard,
  getShardStats
};

