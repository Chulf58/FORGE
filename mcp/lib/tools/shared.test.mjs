// @covers mcp/lib/tools/shared.js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as shared from './shared.js';

test('shared.js exports all 14 named items', () => {
  const expected = [
    'resolveProjectDir',
    'resolveMainProjectDir',
    'readJsonSafe',
    'writeJsonSafe',
    'readCriteria',
    'writeCriteria',
    'errorResult',
    'textResult',
    'requirePipeline',
    'hasGateApprovalToken',
    'pathsEqual',
    'findWorkerTaskFile',
    'runIdSchema',
    'runIdOrBareSchema',
  ];
  for (const name of expected) {
    assert.ok(name in shared, `missing export: ${name}`);
  }
});

test('runIdSchema accepts valid r-<alnum> format', () => {
  const result = shared.runIdSchema.safeParse('r-a1b2c3d4');
  assert.ok(result.success);
});

test('runIdSchema rejects traversal values', () => {
  assert.ok(!shared.runIdSchema.safeParse('../etc').success);
  assert.ok(!shared.runIdSchema.safeParse('r-../escape').success);
});

test('runIdOrBareSchema accepts bare suffix', () => {
  assert.ok(shared.runIdOrBareSchema.safeParse('a1b2c3d4').success);
  assert.ok(shared.runIdOrBareSchema.safeParse('r-a1b2c3d4').success);
});

test('runIdOrBareSchema rejects injection values', () => {
  assert.ok(!shared.runIdOrBareSchema.safeParse('../escape').success);
});

test('errorResult returns isError:true with text content', () => {
  const result = shared.errorResult('something went wrong');
  assert.equal(result.isError, true);
  assert.equal(result.content[0].type, 'text');
  assert.equal(result.content[0].text, 'something went wrong');
});

test('textResult returns JSON-stringified content', () => {
  const result = shared.textResult({ key: 'val' });
  assert.equal(result.content[0].type, 'text');
  assert.equal(result.content[0].text, JSON.stringify({ key: 'val' }));
  assert.ok(!result.isError);
});

test('readJsonSafe returns ok:false for missing file', () => {
  const result = shared.readJsonSafe('/nonexistent/path/file.json');
  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string');
});

test('readJsonSafe returns ok:true for valid JSON', async () => {
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const tmp = join(tmpdir(), `shared-test-${process.pid}.json`);
  writeFileSync(tmp, JSON.stringify({ hello: 'world' }), 'utf-8');
  try {
    const result = shared.readJsonSafe(tmp);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { hello: 'world' });
  } finally {
    unlinkSync(tmp);
  }
});

test('writeJsonSafe + readJsonSafe round-trip', async () => {
  const { unlinkSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const tmp = join(tmpdir(), `shared-test-write-${process.pid}.json`);
  try {
    shared.writeJsonSafe(tmp, { a: 1 });
    const result = shared.readJsonSafe(tmp);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { a: 1 });
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
});

test('requirePipeline returns ok:false when .pipeline absent', () => {
  const result = shared.requirePipeline('/nonexistent/project');
  assert.equal(result.ok, false);
  assert.equal(result.result.isError, true);
});

test('pathsEqual matches identical paths', () => {
  const dir = process.cwd();
  assert.ok(shared.pathsEqual(dir, dir));
});

test('pathsEqual returns false for different paths', () => {
  assert.ok(!shared.pathsEqual('/a/b/c', '/d/e/f'));
});

test('findWorkerTaskFile returns null when .pipeline absent', () => {
  const result = shared.findWorkerTaskFile('/nonexistent/project');
  assert.equal(result, null);
});

test('resolveMainProjectDir delegates to resolveProjectDir', () => {
  // Both should return the same value (resolveMainProjectDir is an alias)
  assert.equal(shared.resolveMainProjectDir(), shared.resolveProjectDir());
});
