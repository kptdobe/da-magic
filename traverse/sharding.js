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
function generateShardPrefixes(basePrefix, count) {
  if (count === 1) {
    return [{
      prefix: basePrefix,
      type: 'all',
      description: 'All files',
      charRange: null
    }];
  }
  
  const shards = [];
  
  // Characters we'll use for sharding (case-sensitive)
  // Using both upper and lowercase is important because S3 is case-sensitive
  const digits = '0123456789';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // Common special characters that are valid and efficient as prefixes
  const specialChars = '_-.';
  
  // All characters to shard on (65 total: 62 alphanum + 3 special)
  const allChars = digits + uppercase + lowercase + specialChars;
  
  // Add catch-all shard first for other special characters (@, +, space, etc.)
  shards.push({
    prefix: basePrefix,
    type: 'catch-all',
    description: 'Files starting with other chars (@, +, space, etc.)',
    charRange: null
  });
  
  // IMPORTANT: S3 prefix matching is literal, not a pattern
  // If we want files starting with '1', '2', '3', we need separate S3 queries
  // So we MUST generate one shard per character for complete coverage
  
  // Generate shards for all explicit characters for complete coverage
  for (let i = 0; i < allChars.length; i++) {
    const char = allChars[i];
    shards.push({
      prefix: basePrefix + char,
      type: 'explicit',
      description: `Files starting with '${char}'`,
      charRange: [char] // Single character only
    });
  }
  
  // Always return all shards (1 catch-all + 65 explicit)
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
  
  // For catch-all shard, filter out alphanumeric AND explicit special chars
  if (shard.type === 'catch-all') {
    return objects.filter(obj => {
      const keyAfterPrefix = obj.Key.substring(basePrefix.length);
      if (!keyAfterPrefix) return true;
      // Exclude 0-9, a-z, A-Z, _, -, .
      return !/^[0-9a-zA-Z_.-]/.test(keyAfterPrefix);
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
    all: 0,
    catchAll: 0, // Alias for backward compat
    characters: []
  };
  
  shards.forEach(shard => {
    if (shard.type === 'catch-all') {
      stats['catch-all']++;
      stats.catchAll++;
    } else if (shard.type === 'alphanum' || shard.type === 'explicit') {
      stats.alphanum++;
      stats.explicit++;
      if (shard.charRange) {
        stats.characters.push(...shard.charRange);
      }
    } else if (shard.type === 'all') {
      stats.all++;
    }
  });
  
  return stats;
}

module.exports = {
  generateShardPrefixes,
  keyBelongsToShard,
  filterObjectsByShard,
  getShardStats
};

