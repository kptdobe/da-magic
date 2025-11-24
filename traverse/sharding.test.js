/**
 * Tests for S3 Key Sharding Logic
 */

const {
  generateShardPrefixes,
  keyBelongsToShard,
  filterObjectsByShard,
  getShardStats
} = require('./sharding.js');

// Color output for test results
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`${colors.green}✓${colors.reset} ${message}`);
  } else {
    failedTests++;
    console.log(`${colors.red}✗${colors.reset} ${message}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  totalTests++;
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    passedTests++;
    console.log(`${colors.green}✓${colors.reset} ${message}`);
  } else {
    failedTests++;
    console.log(`${colors.red}✗${colors.reset} ${message}`);
    console.log(`  Expected: ${expectedStr}`);
    console.log(`  Actual:   ${actualStr}`);
  }
}

function section(title) {
  console.log(`\n${colors.cyan}${title}${colors.reset}`);
}

// Test data: comprehensive list of file names with various patterns
const testFiles = [
  // Lowercase letters
  'prefix/apple.html',
  'prefix/banana.json',
  'prefix/cherry.txt',
  'prefix/zebra.pdf',
  
  // Uppercase letters
  'prefix/Apple.html',
  'prefix/BANANA.json',
  'prefix/Cherry.txt',
  'prefix/ZEBRA.pdf',
  
  // Numbers
  'prefix/001-file.html',
  'prefix/123abc.json',
  'prefix/999-end.txt',
  
  // Special characters
  'prefix/.htaccess',
  'prefix/.hidden',
  'prefix/_config.yml',
  'prefix/_underscore.txt',
  'prefix/-dash-file.html',
  'prefix/@special.json',
  'prefix/#hashtag.txt',
  'prefix/$dollar.html',
  
  // Mixed patterns
  'prefix/aA-mixed-Case.html',
  'prefix/0-starts-with-zero.json',
  'prefix/9-starts-with-nine.html',
  'prefix/zZ-end-letters.txt',
  
  // NESTED FOLDERS (sharding should work on first char after prefix)
  'prefix/fruits/apple.html',
  'prefix/vegetables/carrot.json',
  'prefix/Animals/bear.txt',
  'prefix/COLORS/Blue.html',
  'prefix/123/numbers.txt',
  'prefix/999/nines.json',
  'prefix/.config/settings.json',
  'prefix/_private/data.html',
  
  // DEEPLY NESTED
  'prefix/a/b/c/d/e/file.html',
  'prefix/Z/Y/X/deep.json',
  'prefix/0/1/2/numbers.txt',
  'prefix/.hidden/very/.deep/file.html',
  
  // Edge cases
  'prefix/',  // Folder marker
  'prefix',   // Exact prefix
];

// ==================== TESTS ====================

section('1. Shard Generation Tests');

// Test: Single shard
const shards1 = generateShardPrefixes('test/', 1);
assert(shards1.length === 1, 'Single shard: generates exactly 1 shard');
assert(shards1[0].type === 'all', 'Single shard: type is "all"');
assert(shards1[0].prefix === 'test/', 'Single shard: prefix matches base');

// Test: 16 shards
const shards16 = generateShardPrefixes('test/', 16);
assert(shards16.length === 16, '16 shards: generates exactly 16 shards');
assert(shards16[0].type === 'catch-all', '16 shards: first is catch-all');
assert(shards16.slice(1).every(s => s.type === 'alphanum'), '16 shards: rest are alphanum');

// Test: 62 shards (all alphanumeric + catch-all)
const shards62 = generateShardPrefixes('test/', 62);
assert(shards62.length === 62, '62 shards: generates exactly 62 shards');
assert(shards62[0].type === 'catch-all', '62 shards: first is catch-all');
assert(shards62.length === 62, '62 shards: covers 61 alphanumeric chars + catch-all');

// Test: 63 shards (all 62 alphanumeric + catch-all)
const shards63 = generateShardPrefixes('test/', 63);
assert(shards63.length === 63, '63 shards: generates exactly 63 shards');
assert(shards63[0].type === 'catch-all', '63 shards: first is catch-all');

// Test: Prefix preservation
const shardsPrefix = generateShardPrefixes('my/custom/prefix/', 10);
assert(shardsPrefix.every(s => s.prefix.startsWith('my/custom/prefix/')), 
       'Prefix preservation: all shards start with base prefix');

section('2. Key Belonging Tests');

const testShards = generateShardPrefixes('prefix/', 20);
const catchAllShard = testShards[0];
const firstAlphanumShard = testShards[1];

// Test: Catch-all shard catches special characters
assert(keyBelongsToShard('prefix/.htaccess', catchAllShard, 'prefix/'), 
       'Catch-all: catches dot files');
assert(keyBelongsToShard('prefix/_config.yml', catchAllShard, 'prefix/'), 
       'Catch-all: catches underscore files');
assert(keyBelongsToShard('prefix/-dash.txt', catchAllShard, 'prefix/'), 
       'Catch-all: catches dash files');
assert(keyBelongsToShard('prefix/@special.json', catchAllShard, 'prefix/'), 
       'Catch-all: catches @ files');

// Test: Catch-all does NOT catch alphanumeric
assert(!keyBelongsToShard('prefix/apple.html', catchAllShard, 'prefix/'), 
       'Catch-all: does not catch lowercase letters');
assert(!keyBelongsToShard('prefix/Apple.html', catchAllShard, 'prefix/'), 
       'Catch-all: does not catch uppercase letters');
assert(!keyBelongsToShard('prefix/123.txt', catchAllShard, 'prefix/'), 
       'Catch-all: does not catch numbers');

section('3. Complete Coverage Tests');

// Test: Every file belongs to exactly one shard
const shards32 = generateShardPrefixes('prefix/', 32);

testFiles.forEach(file => {
  if (!file || file === 'prefix' || file === 'prefix/') {
    return; // Skip edge cases for this test
  }
  
  const matchingShards = shards32.filter(shard => 
    keyBelongsToShard(file, shard, 'prefix/')
  );
  
  assert(matchingShards.length === 1, 
         `Coverage: "${file}" belongs to exactly 1 shard (found ${matchingShards.length})`);
});

section('4. Case Sensitivity Tests');

// Test: Uppercase and lowercase are treated differently
const shardsCase = generateShardPrefixes('prefix/', 40);

const lowerA = shardsCase.find(s => s.prefix === 'prefix/a');
const upperA = shardsCase.find(s => s.prefix === 'prefix/A');

if (lowerA && upperA) {
  assert(keyBelongsToShard('prefix/apple.html', lowerA, 'prefix/'), 
         'Case: lowercase "a" shard catches lowercase files');
  assert(keyBelongsToShard('prefix/Apple.html', upperA, 'prefix/'), 
         'Case: uppercase "A" shard catches uppercase files');
  assert(!keyBelongsToShard('prefix/Apple.html', lowerA, 'prefix/'), 
         'Case: lowercase shard does not catch uppercase files');
  assert(!keyBelongsToShard('prefix/apple.html', upperA, 'prefix/'), 
         'Case: uppercase shard does not catch lowercase files');
}

section('5. Filter Objects Tests');

const mockObjects = [
  { Key: 'prefix/apple.html', Size: 100 },
  { Key: 'prefix/Apple.html', Size: 200 },
  { Key: 'prefix/.htaccess', Size: 50 },
  { Key: 'prefix/123.txt', Size: 75 },
  { Key: 'prefix/_config.yml', Size: 30 },
];

const filterShards = generateShardPrefixes('prefix/', 20);
const filterCatchAll = filterShards[0];

const filtered = filterObjectsByShard(mockObjects, filterCatchAll, 'prefix/');
assert(filtered.length === 2, `Filter: catch-all gets 2 special char files (got ${filtered.length})`);
assert(filtered.every(obj => !/^prefix\/[0-9a-zA-Z]/.test(obj.Key)), 
       'Filter: all filtered objects are special chars');

section('6. Statistics Tests');

const stats = getShardStats(shards32);
assert(stats.total === 32, `Stats: total is 32 (got ${stats.total})`);
assert(stats.catchAll === 1, `Stats: catchAll is 1 (got ${stats.catchAll})`);
assert(stats.alphanum === 31, `Stats: alphanum is 31 (got ${stats.alphanum})`);

section('7. Nested Folder Tests (Critical)');

// Test: Sharding works on first character after prefix, regardless of depth
const nestedTests = [
  { file: 'prefix/fruits/apple.html', expectedFirstChar: 'f', desc: 'subfolder starting with "f"' },
  { file: 'prefix/Animals/bear.txt', expectedFirstChar: 'A', desc: 'subfolder starting with "A"' },
  { file: 'prefix/123/numbers.txt', expectedFirstChar: '1', desc: 'subfolder starting with "1"' },
  { file: 'prefix/.config/settings.json', expectedFirstChar: '.', desc: 'hidden subfolder' },
  { file: 'prefix/_private/data.html', expectedFirstChar: '_', desc: 'underscore subfolder' },
  { file: 'prefix/a/b/c/d/e/file.html', expectedFirstChar: 'a', desc: 'deeply nested under "a"' },
  { file: 'prefix/Z/Y/X/deep.json', expectedFirstChar: 'Z', desc: 'deeply nested under "Z"' },
];

const nestedShards = generateShardPrefixes('prefix/', 32);

nestedTests.forEach(({ file, expectedFirstChar, desc }) => {
  const matchingShards = nestedShards.filter(shard => 
    keyBelongsToShard(file, shard, 'prefix/')
  );
  
  assert(matchingShards.length === 1, 
         `Nested: ${desc} belongs to exactly 1 shard (found ${matchingShards.length})`);
  
  if (matchingShards.length === 1) {
    const shard = matchingShards[0];
    if (shard.type === 'alphanum') {
      assert(shard.charRange.includes(expectedFirstChar), 
             `Nested: ${desc} matches shard containing '${expectedFirstChar}'`);
    } else if (shard.type === 'catch-all') {
      assert(!/[0-9a-zA-Z]/.test(expectedFirstChar), 
             `Nested: ${desc} correctly assigned to catch-all`);
    }
  }
});

// Test: Multiple files in same subfolder belong to same shard
const sameFolder = [
  'prefix/fruits/apple.html',
  'prefix/fruits/banana.json',
  'prefix/fruits/cherry.txt',
];

const sameFolderShards = sameFolder.map(file => {
  const matches = nestedShards.filter(s => keyBelongsToShard(file, s, 'prefix/'));
  return matches[0];
}).filter(Boolean);

const allSameShard = sameFolderShards.every(s => s === sameFolderShards[0]);
assert(allSameShard, 
       'Nested: All files in same subfolder (fruits/) belong to same shard');

// Test: Files with same name in different subfolders belong to different shards
const sameFileName = [
  { file: 'prefix/apples/file.html', firstChar: 'a' },
  { file: 'prefix/bananas/file.html', firstChar: 'b' },
  { file: 'prefix/Apples/file.html', firstChar: 'A' },
];

sameFileName.forEach(({ file, firstChar }) => {
  const matches = nestedShards.filter(s => keyBelongsToShard(file, s, 'prefix/'));
  if (matches.length === 1 && matches[0].type === 'alphanum') {
    assert(matches[0].charRange.includes(firstChar),
           `Nested: ${file} correctly sharded by first char '${firstChar}' not filename`);
  }
});

section('8. No Missing Files Test (Critical)');

// This is the most important test: ensure ALL files are covered
const comprehensiveFiles = [
  // Every digit
  ...Array.from({length: 10}, (_, i) => `prefix/${i}file.txt`),
  // Every lowercase letter
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map(c => `prefix/${c}file.txt`),
  // Every uppercase letter  
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => `prefix/${c}file.txt`),
  // Common special characters
  'prefix/.htaccess',
  'prefix/_file.txt',
  'prefix/-file.txt',
  'prefix/@file.txt',
  'prefix/#file.txt',
  'prefix/$file.txt',
  'prefix/%file.txt',
  'prefix/^file.txt',
  'prefix/&file.txt',
  'prefix/!file.txt',
];

const testShardCounts = [1, 10, 16, 32, 62, 63];

testShardCounts.forEach(count => {
  const shards = generateShardPrefixes('prefix/', count);
  const uncovered = [];
  
  comprehensiveFiles.forEach(file => {
    const matchingShards = shards.filter(shard => 
      keyBelongsToShard(file, shard, 'prefix/')
    );
    
    if (matchingShards.length === 0) {
      uncovered.push(file);
    }
  });
  
  assert(uncovered.length === 0, 
         `No missing files with ${count} shards (${uncovered.length} uncovered: ${uncovered.slice(0, 5).join(', ')})`);
});

// ==================== SUMMARY ====================

console.log(`\n${'='.repeat(70)}`);
console.log(`${colors.cyan}TEST SUMMARY${colors.reset}`);
console.log(`${'='.repeat(70)}`);
console.log(`Total:  ${totalTests}`);
console.log(`${colors.green}Passed: ${passedTests}${colors.reset}`);
if (failedTests > 0) {
  console.log(`${colors.red}Failed: ${failedTests}${colors.reset}`);
  process.exit(1);
} else {
  console.log(`${colors.green}All tests passed! ✓${colors.reset}`);
  process.exit(0);
}

