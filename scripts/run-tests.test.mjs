// Test for scripts/run-tests.mjs discovery configuration.
// Closes a6a60b0d — runner must discover hooks/*-test.mjs files (not just
// .js), so the regression suite picks up resolveRunId/dispatch-context/
// worker-task-inject-marker tests and the agent-loop-guard test that this
// session realigned.
//
// Run: node --test scripts/run-tests.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_TESTS_PATH = resolve(__dirname, 'run-tests.mjs');

test('TEST_LOCATIONS includes hooks/*-test.mjs discovery', () => {
  const src = readFileSync(RUN_TESTS_PATH, 'utf8');
  // Source-level check: the TEST_LOCATIONS array must contain a `hooks` entry
  // with `-test.mjs` suffix. Without it, .mjs test files under hooks/ are
  // silently skipped by the regression runner (observed pre-fix this session).
  const pattern = /\{\s*dir:\s*['"]hooks['"]\s*,\s*suffix:\s*['"]-test\.mjs['"]\s*\}/;
  assert.match(src, pattern,
    'scripts/run-tests.mjs:TEST_LOCATIONS must include { dir: "hooks", suffix: "-test.mjs" }');
});

test('TEST_LOCATIONS includes mcp/lib/*-test.mjs discovery', () => {
  const src = readFileSync(RUN_TESTS_PATH, 'utf8');
  // mcp/lib/ tests (e.g. learnings-extractor-test.mjs) must be auto-discovered.
  // readdirSync is non-recursive — mcp/ root scan misses mcp/lib/ files.
  const pattern = /\{\s*dir:\s*['"]mcp\/lib['"]\s*,\s*suffix:\s*['"]-test\.mjs['"]\s*\}/;
  assert.match(src, pattern,
    'scripts/run-tests.mjs:TEST_LOCATIONS must include { dir: "mcp/lib", suffix: "-test.mjs" }');
});
