#!/usr/bin/env node
// Regression tests for dashboard-server.mjs runId validation.
// Tests isValidRunId() directly — no server spawn required.
// Run: node scripts/dashboard-server-runid-test.mjs

import { isValidRunId } from './dashboard-server.mjs';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log('  PASS  ' + label); passed++; }
  else { console.error('  FAIL  ' + label); failed++; }
}

console.log('\n── dashboard-server-runid-test.mjs ──────────────────────────────────────');

// Valid run IDs
assert(isValidRunId('r-d1afe1f3'), 'valid: r-d1afe1f3');
assert(isValidRunId('r-abc123'),   'valid: r-abc123');
assert(isValidRunId('r-A1B2C3'),   'valid: r-A1B2C3 (mixed case)');

// Path traversal attempts
assert(!isValidRunId('../../.pipeline/gate-pending.json'), 'reject: path traversal with ../');
assert(!isValidRunId('r-abc/../../../etc/passwd'),         'reject: traversal embedded in r- prefix');
assert(!isValidRunId('/etc/passwd'),                       'reject: absolute path');

// Shell injection attempts
assert(!isValidRunId('r-abc; rm -rf .'),    'reject: semicolon injection');
assert(!isValidRunId('r-abc$(whoami)'),      'reject: command substitution');
assert(!isValidRunId('r-abc`whoami`'),       'reject: backtick substitution');

// Malformed / missing
assert(!isValidRunId(''),           'reject: empty string');
assert(!isValidRunId(null),         'reject: null');
assert(!isValidRunId(undefined),    'reject: undefined');
assert(!isValidRunId(42),           'reject: number');
assert(!isValidRunId('abc123'),     'reject: missing r- prefix');
assert(!isValidRunId('r-'),         'reject: r- with no suffix');
assert(!isValidRunId('r-abc def'),  'reject: space in runId');
assert(!isValidRunId('r-abc.def'),  'reject: dot in runId');

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
