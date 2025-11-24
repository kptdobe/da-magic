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
  
  // All alphanumeric characters in ASCII order (62 total)
  const allAlphanum = digits + uppercase + lowercase;
  
  // Add catch-all shard first for special characters (., _, -, etc.)
  shards.push({
    prefix: basePrefix,
    type: 'catch-all',
    description: 'Files starting with special chars (., _, -, etc.)',
    charRange: null
  });
  
  // IMPORTANT: S3 prefix matching is literal, not a pattern
  // If we want files starting with '1', '2', '3', we need separate S3 queries
  // So we MUST generate one shard per character for complete coverage
  
  // Generate all 62 alphanumeric shards for complete coverage
  for (let i = 0; i < allAlphanum.length; i++) {
    const char = allAlphanum[i];
    shards.push({
      prefix: basePrefix + char,
      type: 'alphanum',
      description: `Files starting with '${char}'`,
      charRange: [char] // Single character only
    });
  }
  
  // Always return all 63 shards for complete coverage
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
  
  // For catch-all shard, accept only non-alphanumeric characters
  if (shard.type === 'catch-all') {
    return !/[0-9a-zA-Z]/.test(firstChar);
  }
  
  // For alphanum shards, check if first character is in the range
  if (shard.type === 'alphanum') {
    if (shard.charRange) {
      return shard.charRange.includes(firstChar);
    }
    // Fallback: check if key starts with shard prefix
    return key.startsWith(shard.prefix);
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
  
  // For catch-all shard, filter out alphanumeric
  if (shard.type === 'catch-all') {
    return objects.filter(obj => {
      const keyAfterPrefix = obj.Key.substring(basePrefix.length);
      if (!keyAfterPrefix) return true;
      return !/^[0-9a-zA-Z]/.test(keyAfterPrefix);
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
    alphanum: 0,
    all: 0,
    catchAll: 0, // Alias for backward compat
    characters: []
  };
  
  shards.forEach(shard => {
    if (shard.type === 'catch-all') {
      stats['catch-all']++;
      stats.catchAll++;
    } else if (shard.type === 'alphanum') {
      stats.alphanum++;
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

