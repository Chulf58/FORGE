#!/usr/bin/env node
// Tests for scripts/covers-parser.mjs — @covers tag parser.
//
// AC-1 assertions:
//   (a) file with `// @covers scripts/lean-risk-classify.mjs` returns
//       { covered: ['scripts/lean-risk-classify.mjs'] }
//   (b) file with no @covers tag returns { covered: [] }
//   (c) multiple @covers lines in one file are all collected
//   (d) normalization — `// @covers ./scripts/foo.mjs` strips leading ./
//   (e) path normalization — backslashes converted to forward-slashes
//
// Run: node --test scripts/covers-parser-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

// @covers scripts/covers-parser.mjs
import { parseCovers } from './covers-parser.mjs';

test('(a) single @covers line returns covered path', () => {
  const content = `// @covers scripts/lean-risk-classify.mjs\nimport foo from './foo.mjs';\n`;
  const result = parseCovers(content);
  assert.deepEqual(result, { covered: ['scripts/lean-risk-classify.mjs'] });
});

test('(b) file with no @covers tag returns empty covered array', () => {
  const content = `import foo from './foo.mjs';\nexport function bar() {}\n`;
  const result = parseCovers(content);
  assert.deepEqual(result, { covered: [] });
});

test('(c) multiple @covers lines are all collected', () => {
  const content = [
    '// @covers scripts/lean-risk-classify.mjs',
    '// @covers scripts/wave-split.mjs',
    '// @covers scripts/run-tests.mjs',
    'import foo from "./foo.mjs";',
  ].join('\n');
  const result = parseCovers(content);
  assert.deepEqual(result, {
    covered: [
      'scripts/lean-risk-classify.mjs',
      'scripts/wave-split.mjs',
      'scripts/run-tests.mjs',
    ],
  });
});

test('(d) leading ./ is stripped from @covers path', () => {
  const content = `// @covers ./scripts/foo.mjs\n`;
  const result = parseCovers(content);
  assert.deepEqual(result, { covered: ['scripts/foo.mjs'] });
});

test('(e) Windows backslashes in @covers path are normalized to forward-slashes', () => {
  const content = `// @covers scripts\\\\foo.mjs\n`;
  const result = parseCovers(content);
  assert.deepEqual(result, { covered: ['scripts/foo.mjs'] });
});
