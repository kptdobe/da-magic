/**
 * Tests for S3 Key Sharding Logic
 */

const {
  generateShardPrefixes,
  generateHexShardPrefixes,
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

// Test: Request any count returns the full explicit set (74: 62 alphanum + 12 special, no catch-all)
const shards16 = generateShardPrefixes('test/', 16);
assert(shards16.length === 74, '16 shards request: actually generates 74 for coverage (no catch-all)');
assert(shards16.every(s => s.type === 'alphanum' || s.type === 'explicit'),
       '16 shards request: all are explicit type (no catch-all)');

const shards66 = generateShardPrefixes('test/', 66);
assert(shards66.length === 74, '66 shards: generates exactly 74 shards (62 alphanum + 12 special)');
assert(shards66.every(s => s.type === 'explicit' || s.type === 'alphanum'), '66 shards: all explicit, no catch-all');

const shards67 = generateShardPrefixes('test/', 67);
assert(shards67.length === 74, '67 shards: generates exactly 74 shards');

// Test: Prefix preservation
const shardsPrefix = generateShardPrefixes('my/custom/prefix/', 10);
assert(shardsPrefix.every(s => s.prefix.startsWith('my/custom/prefix/')), 
       'Prefix preservation: all shards start with base prefix');

section('2. Key Belonging Tests');

const testShards = generateShardPrefixes('prefix/', 20);

// All known special chars have explicit shards — no catch-all
assert(testShards.find(s => s.prefix === 'prefix/@'), 'Explicit: @ has its own shard');
assert(testShards.find(s => s.prefix === 'prefix/.'), 'Explicit: . has its own shard');
assert(testShards.find(s => s.prefix === 'prefix/_'), 'Explicit: _ has its own shard');
assert(testShards.find(s => s.prefix === 'prefix/-'), 'Explicit: - has its own shard');
assert(testShards.find(s => s.prefix === 'prefix/$'), 'Explicit: $ has its own shard');
assert(!testShards.find(s => s.type === 'catch-all'), 'No catch-all shard in alphanum mode');

section('3. Complete Coverage Tests');

// Test: Every file belongs to exactly one shard
const shards32 = generateShardPrefixes('prefix/', 32);

// Chars not in our explicit list (#, $dollar already covered, ^, &, !) are intentionally skipped
const notCoveredChars = new Set(['#', '^', '&', '!', '+']);
testFiles.forEach(file => {
  if (!file || file === 'prefix' || file === 'prefix/') return;
  const charAfterPrefix = file.substring('prefix/'.length)[0];
  if (notCoveredChars.has(charAfterPrefix)) return;

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
  { Key: 'prefix/@special.json', Size: 10 },
];

const filterShards = generateShardPrefixes('prefix/', 20);

// All explicit shards are pass-through — S3 prefix already filtered
const dotShard = filterShards.find(s => s.prefix === 'prefix/.');
const atShard = filterShards.find(s => s.prefix === 'prefix/@');
// S3 would only return .htaccess for the dot shard
const s3DotResult = mockObjects.filter(o => o.Key.startsWith('prefix/.'));
const filteredDot = filterObjectsByShard(s3DotResult, dotShard, 'prefix/');
assert(filteredDot.length === 1, `Filter: dot shard pass-through keeps 1 object (got ${filteredDot.length})`);
assert(filteredDot[0].Key === 'prefix/.htaccess', 'Filter: dot shard kept .htaccess');
// S3 would only return @special for the @ shard
const s3AtResult = mockObjects.filter(o => o.Key.startsWith('prefix/@'));
const filteredAt = filterObjectsByShard(s3AtResult, atShard, 'prefix/');
assert(filteredAt.length === 1, `Filter: @ shard pass-through keeps 1 object (got ${filteredAt.length})`);
assert(filteredAt[0].Key === 'prefix/@special.json', 'Filter: @ shard kept @special.json');

section('6. Statistics Tests');

const stats = getShardStats(shards32);
assert(stats.total === 74, `Stats: total is 74 (62 alphanum + 12 special, no catch-all), got ${stats.total}`);
assert(stats.catchAll === 0, `Stats: catchAll is 0 (no catch-all), got ${stats.catchAll}`);
assert(stats.alphanum === 74, `Stats: alphanum/explicit is 74 (got ${stats.alphanum})`);

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

// Chars explicitly covered (derived from real S3 key data analysis)
const coveredFiles = [
  // Every digit
  ...Array.from({length: 10}, (_, i) => `prefix/${i}file.txt`),
  // Every lowercase letter
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map(c => `prefix/${c}file.txt`),
  // Every uppercase letter
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => `prefix/${c}file.txt`),
  // All explicit special chars
  `prefix/.htaccess`, `prefix/_file.txt`, `prefix/-file.txt`, `prefix/@file.txt`,
  `prefix/$file.txt`, `prefix/%file.txt`, `prefix/'file.txt`, `prefix/(file.txt`,
  `prefix/,file.txt`, `prefix/;file.txt`, `prefix/[file.txt`, `prefix/~file.txt`,
];

// Chars NOT covered (not found in real data — intentional)
const notCoveredFiles = [
  'prefix/#file.txt', 'prefix/^file.txt', 'prefix/&file.txt', 'prefix/!file.txt',
];

const testShardCounts = [1, 10, 16, 32, 62, 63];

testShardCounts.forEach(count => {
  const shards = generateShardPrefixes('prefix/', count);

  const uncovered = coveredFiles.filter(file =>
    shards.filter(shard => keyBelongsToShard(file, shard, 'prefix/')).length === 0
  );
  assert(uncovered.length === 0,
    `No missing covered files with ${count} shards (${uncovered.length} uncovered: ${uncovered.slice(0, 5).join(', ')})`);

  if (count > 1) {
    const wronglyCovered = notCoveredFiles.filter(file =>
      shards.filter(shard => keyBelongsToShard(file, shard, 'prefix/')).length > 0
    );
    assert(wronglyCovered.length === 0,
      `Non-data chars not covered with ${count} shards (${wronglyCovered.join(', ')})`);
  }
});

section('9. Hex Shard Generation Tests');

// Default: 256 hex shards only
const hexShards = generateHexShardPrefixes('org/.da-versions/');
assert(hexShards.length === 256, `Hex: default generates 256 shards, got ${hexShards.length}`);
assert(hexShards[0].prefix === 'org/.da-versions/00', 'Hex: first shard is 00');
assert(hexShards[255].prefix === 'org/.da-versions/ff', 'Hex: last shard is ff');
assert(hexShards.every(s => s.type === 'hex'), 'Hex: all default shards are hex type');

// With extraChars: 256 + N explicit shards, no full-scan catch-all
const hexShardsWithExtra = generateHexShardPrefixes('org/.da-versions/', { extraChars: ['.', '_', '-', '@'] });
assert(hexShardsWithExtra.length === 260, `Hex: with 4 extraChars generates 260 shards, got ${hexShardsWithExtra.length}`);
assert(hexShardsWithExtra.slice(0, 256).every(s => s.type === 'hex'), 'Hex: first 256 are hex type');
assert(hexShardsWithExtra.slice(256).every(s => s.type === 'explicit'), 'Hex: last 4 are explicit type');
assert(hexShardsWithExtra[256].prefix === 'org/.da-versions/.', 'Hex: extra shard for "."');
assert(hexShardsWithExtra[259].prefix === 'org/.da-versions/@', 'Hex: extra shard for "@"');

// Backward compat alias for tests below
const hexShardsWithCatchAll = hexShardsWithExtra;

section('10. Hex Shard Coverage Tests');

const hexBase = 'org/.da-versions/';
// UUID keys: covered by hex shards (no catch-all needed)
const hexUuidFiles = [
  { key: 'org/.da-versions/00abc123/file.html', expectHexPrefix: '00' },
  { key: 'org/.da-versions/ff000000-1234/file.json', expectHexPrefix: 'ff' },
  { key: 'org/.da-versions/a1b2c3d4/file.html', expectHexPrefix: 'a1' },
  { key: 'org/.da-versions/9f3e2100/file.png', expectHexPrefix: '9f' },
];

hexUuidFiles.forEach(({ key, expectHexPrefix }) => {
  const matchingShards = hexShards.filter(s => key.startsWith(s.prefix));
  assert(matchingShards.length === 1, `Hex coverage: "${key}" matches exactly 1 hex shard (got ${matchingShards.length})`);
  if (matchingShards.length === 1) {
    assert(matchingShards[0].prefix === hexBase + expectHexPrefix,
      `Hex: "${key}" goes to shard ${expectHexPrefix}`);
  }
});

// Special char keys: not caught by default hex shards, caught by explicit extra shards
const hexSpecialFiles = [
  { key: 'org/.da-versions/.hidden/file.html', char: '.' },
  { key: 'org/.da-versions/_private/file.txt', char: '_' },
  { key: 'org/.da-versions/-dash/file.svg', char: '-' },
  { key: 'org/.da-versions/@special/file.pdf', char: '@' },
];

hexSpecialFiles.forEach(({ key, char }) => {
  const matchInDefault = hexShards.filter(s => key.startsWith(s.prefix));
  assert(matchInDefault.length === 0, `Hex: "${key}" not matched by default hex shards`);

  const matchWithExtra = hexShardsWithExtra.filter(s => key.startsWith(s.prefix));
  assert(matchWithExtra.length === 1, `Hex: "${key}" matched by explicit extra shard (got ${matchWithExtra.length})`);
  assert(matchWithExtra[0].type === 'explicit', `Hex: "${key}" goes to explicit shard for '${char}'`);
  assert(matchWithExtra[0].prefix === hexBase + char, `Hex: "${key}" shard prefix is ${hexBase + char}`);
});

section('11. Hex FilterObjectsByShard Tests');

// For filter tests, use a manually constructed catch-all-hex shard to test that code path
const hexCatchAll = { prefix: hexBase, type: 'catch-all-hex', description: 'test', charRange: null };
const hexMockObjects = [
  { Key: 'org/.da-versions/00abcdef/file.html', Size: 100 },
  { Key: 'org/.da-versions/ff123456/file.json', Size: 200 },
  { Key: 'org/.da-versions/.hidden/file.html', Size: 50 },
  { Key: 'org/.da-versions/_private/file.txt', Size: 75 },
  { Key: 'org/.da-versions/-dash/file.svg', Size: 30 },
  { Key: 'org/.da-versions/@other/file.pdf', Size: 10 },
];

const hexFiltered = filterObjectsByShard(hexMockObjects, hexCatchAll, hexBase);
assert(hexFiltered.length === 4, `Hex filter: catch-all-hex keeps 4 special-char files (got ${hexFiltered.length})`);
assert(hexFiltered.every(o => !/^org\/.da-versions\/[0-9a-f]{2}/i.test(o.Key)),
  'Hex filter: no hex-prefixed keys in catch-all result');

// For hex shards, S3 has already filtered by prefix — filterObjectsByShard is a pass-through.
// Simulate what S3 returns: only objects matching the shard prefix.
const hexShard00 = hexShardsWithCatchAll.find(s => s.prefix === 'org/.da-versions/00');
const s3ResultFor00 = hexMockObjects.filter(o => o.Key.startsWith(hexShard00.prefix));
const hexFiltered00 = filterObjectsByShard(s3ResultFor00, hexShard00, hexBase);
assert(hexFiltered00.length === 1, `Hex filter: shard 00 pass-through keeps 1 object (got ${hexFiltered00.length})`);
assert(hexFiltered00[0].Key === 'org/.da-versions/00abcdef/file.html', 'Hex filter: shard 00 kept correct key');

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

