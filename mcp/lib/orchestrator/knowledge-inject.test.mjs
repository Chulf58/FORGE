// @covers mcp/lib/orchestrator/knowledge-inject.mjs
// Tests for knowledge-inject — Gap-1 auto-injection of task-relevant gotchas.
// Pure function `buildInjectedKnowledge(keywords, projectDir) -> string`:
// given task keywords, returns matching gotcha/solution sections as injectable
// prompt text (reusing searchConstraints/searchPatterns from knowledge-store.js).
//
// Run: node --test mcp/lib/orchestrator/knowledge-inject.test.mjs
//
// RED BAR: until knowledge-inject.mjs exists, buildInjectedKnowledge is null and
// every call below throws → all tests fail. Once implemented correctly per AC-12,
// these become GREEN. (No assert.fail placeholders — real behavior assertions.)

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// projectDir = repo root (this test lives at mcp/lib/orchestrator/)
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let buildInjectedKnowledge;
try {
  ({ buildInjectedKnowledge } = await import('./knowledge-inject.mjs'));
} catch {
  buildInjectedKnowledge = null;
}

test('module exports buildInjectedKnowledge function', () => {
  assert.equal(typeof buildInjectedKnowledge, 'function', 'buildInjectedKnowledge export missing or not a function');
});

test('(a) keyword matching a known gotcha heading returns non-empty text containing the match', () => {
  // "frontmatter" matches docs/gotchas/GENERAL.md "## Agent frontmatter — required fields"
  const out = buildInjectedKnowledge(['frontmatter'], projectDir);
  assert.equal(typeof out, 'string', 'must return a string');
  assert.ok(out.length > 0, 'expected non-empty injectable text for a matching keyword');
  assert.match(out, /frontmatter/i, 'injected text should contain the matched section');
});

test('(b) keyword matching nothing returns empty string', () => {
  const out = buildInjectedKnowledge(['xyzzy-zzz-no-such-token-9999'], projectDir);
  assert.equal(out, '');
});

test('(c) empty / whitespace / null keyword inputs return empty string without throwing', () => {
  assert.equal(buildInjectedKnowledge([], projectDir), '');
  assert.equal(buildInjectedKnowledge(['', '   '], projectDir), '');
  assert.equal(buildInjectedKnowledge(null, projectDir), '');
});

test('(d) morphological near-miss is a documented KNOWN MISS (records deterministic recall boundary)', () => {
  // Deterministic substring matching: the needle must be CONTAINED in the heading/content.
  // The plural variant "frontmatters" is NOT a substring of "frontmatter", so it misses.
  // This records the recall boundary as a defer-until-evidence trip-wire: if this ever
  // returns non-empty, matching improved (e.g. stemming) and AC-12(d) should be revisited.
  const out = buildInjectedKnowledge(['frontmatters'], projectDir);
  assert.equal(out, '', 'morphological variant "frontmatters" is a known miss under substring matching');
});
