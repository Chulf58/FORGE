'use strict';
// Regression tests for hooks/hook-utils.js resolveProjectDir()
// Run: node hooks/hook-utils-test.js

const path = require('path');
const { resolveProjectDir } = require('./hook-utils');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  PASS  ' + label);
    passed++;
  } else {
    console.error('  FAIL  ' + label);
    failed++;
  }
}

const actual = process.cwd();

// Capture stderr to verify warning messages without polluting test output
const stderrLines = [];
const origStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (data, ...rest) => {
  stderrLines.push(String(data));
  return origStderr(data, ...rest);
};

function lastStderr() { return stderrLines[stderrLines.length - 1] || ''; }

console.log('\n── hook-utils-test.js ───────────────────────────────────────────────────');

// 1. Matching absolute cwd is accepted, returned as-is
{
  const result = resolveProjectDir({ cwd: actual });
  assert(result === actual, 'matching absolute cwd: returned as-is');
}

// 2. Missing cwd falls back to process.cwd() silently
{
  const before = stderrLines.length;
  const result = resolveProjectDir({});
  assert(result === actual, 'missing cwd: falls back to process.cwd()');
  assert(stderrLines.length === before, 'missing cwd: no stderr warning emitted');
}

// 3. Non-absolute cwd falls back with warning
{
  const result = resolveProjectDir({ cwd: 'relative/path' });
  assert(result === actual, 'non-absolute cwd: falls back to process.cwd()');
  assert(lastStderr().includes('not absolute'), 'non-absolute cwd: stderr warning emitted');
}

// 4. Mismatched absolute cwd falls back with warning
{
  const result = resolveProjectDir({ cwd: '/tmp/attacker-controlled' });
  assert(result === actual, 'mismatched cwd: falls back to process.cwd()');
  assert(lastStderr().includes('mismatch'), 'mismatched cwd: stderr warning mentions mismatch');
}

// 5. Non-string cwd falls back silently
{
  const before = stderrLines.length;
  const result = resolveProjectDir({ cwd: 42 });
  assert(result === actual, 'non-string cwd: falls back to process.cwd()');
  assert(stderrLines.length === before, 'non-string cwd: no stderr warning');
}

// 6. Null payload falls back silently
{
  const before = stderrLines.length;
  const result = resolveProjectDir(null);
  assert(result === actual, 'null payload: falls back to process.cwd()');
  assert(stderrLines.length === before, 'null payload: no stderr warning');
}

// 7. Path traversal attempt rejected
{
  const result = resolveProjectDir({ cwd: actual + '/../../../etc' });
  assert(result === actual, 'path traversal attempt: falls back to process.cwd()');
  assert(lastStderr().includes('mismatch'), 'path traversal attempt: stderr warning emitted');
}

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
