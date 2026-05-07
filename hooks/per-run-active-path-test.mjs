'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Inline the path-resolution helpers so this test has no runtime dependency
// on hook-utils (which is CJS and requires a live project dir).
// ---------------------------------------------------------------------------

const RUN_ID_RE = /^r-[a-zA-Z0-9]+$/;

/**
 * Resolve the per-run active path for a given runId, or null when the
 * runId is absent / invalid.
 *
 * @param {string} workDir
 * @param {string|null|undefined} rawRunId
 * @returns {string|null}
 */
function resolvePerRunPath(workDir, rawRunId) {
  if (!rawRunId || typeof rawRunId !== 'string') return null;
  if (!RUN_ID_RE.test(rawRunId)) return null;
  return path.join(workDir, '.pipeline', 'runs', rawRunId, 'run-active.json');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('resolvePerRunPath — valid runId returns correct path', () => {
  const result = resolvePerRunPath('/project', 'r-abc123');
  assert.equal(result, path.join('/project', '.pipeline', 'runs', 'r-abc123', 'run-active.json'));
});

test('resolvePerRunPath — null runId returns null', () => {
  assert.equal(resolvePerRunPath('/project', null), null);
});

test('resolvePerRunPath — undefined runId returns null', () => {
  assert.equal(resolvePerRunPath('/project', undefined), null);
});

test('resolvePerRunPath — empty string returns null', () => {
  assert.equal(resolvePerRunPath('/project', ''), null);
});

test('resolvePerRunPath — runId missing r- prefix returns null', () => {
  assert.equal(resolvePerRunPath('/project', 'abc123'), null);
});

test('resolvePerRunPath — runId with path-traversal characters returns null', () => {
  assert.equal(resolvePerRunPath('/project', 'r-../evil'), null);
});

test('resolvePerRunPath — runId with slash returns null', () => {
  assert.equal(resolvePerRunPath('/project', 'r-abc/123'), null);
});

test('resolvePerRunPath — runId with special chars returns null', () => {
  assert.equal(resolvePerRunPath('/project', 'r-abc!@#'), null);
});

test('resolvePerRunPath — runId r-fcedb742 (real run) returns correct path', () => {
  const result = resolvePerRunPath('/project', 'r-fcedb742');
  assert.equal(result, path.join('/project', '.pipeline', 'runs', 'r-fcedb742', 'run-active.json'));
});

test('resolvePerRunPath — runId with uppercase is valid', () => {
  const result = resolvePerRunPath('/project', 'r-ABC123');
  assert.equal(result, path.join('/project', '.pipeline', 'runs', 'r-ABC123', 'run-active.json'));
});
