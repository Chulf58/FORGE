#!/usr/bin/env node
// Tests for scripts/covers-map.mjs — impact-map builder.
//
// AC-2 assertions:
//   (a) given two fixture test files each declaring @covers, the map returns
//       srcFile → [testFile, …] with correct entries (canonical forward-slash keys)
//   (b) a test file declaring no @covers contributes no entries to the map
//
// Run: node --test scripts/covers-map-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// @covers scripts/covers-map.mjs
import { buildCoversMap } from './covers-map.mjs';

function makeTmpProject() {
  const root = mkdtempSync(join(tmpdir(), 'covers-map-test-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'hooks'), { recursive: true });
  mkdirSync(join(root, 'mcp'), { recursive: true });
  return root;
}

function writeFile(root, relPath, content) {
  writeFileSync(join(root, relPath), content, 'utf8');
}

test('(a) two fixture test files with @covers produce correct srcFile → [testFile] map', async () => {
  const root = makeTmpProject();
  try {
    // Fixture test file A covers scripts/lean-risk-classify.mjs
    writeFile(root, 'scripts/alpha-test.mjs', [
      '// @covers scripts/lean-risk-classify.mjs',
      'import { test } from "node:test";',
      'test("placeholder", () => {});',
    ].join('\n'));

    // Fixture test file B covers scripts/wave-split.mjs
    writeFile(root, 'scripts/beta-test.mjs', [
      '// @covers scripts/wave-split.mjs',
      '// @covers scripts/lean-risk-classify.mjs',
      'import { test } from "node:test";',
      'test("placeholder", () => {});',
    ].join('\n'));

    const map = await buildCoversMap(root);

    // lean-risk-classify.mjs should appear in both test files
    assert.ok(
      Object.prototype.hasOwnProperty.call(map, 'scripts/lean-risk-classify.mjs'),
      'map has key scripts/lean-risk-classify.mjs',
    );
    const leanEntry = map['scripts/lean-risk-classify.mjs'];
    assert.ok(Array.isArray(leanEntry), 'value is an array');
    // Both alpha-test and beta-test should be listed (forward-slash paths)
    const normalised = leanEntry.map(p => p.replace(/\\/g, '/'));
    assert.ok(
      normalised.some(p => p.endsWith('scripts/alpha-test.mjs')),
      'alpha-test.mjs listed for lean-risk-classify.mjs',
    );
    assert.ok(
      normalised.some(p => p.endsWith('scripts/beta-test.mjs')),
      'beta-test.mjs listed for lean-risk-classify.mjs',
    );

    // wave-split.mjs should appear only in beta-test
    assert.ok(
      Object.prototype.hasOwnProperty.call(map, 'scripts/wave-split.mjs'),
      'map has key scripts/wave-split.mjs',
    );
    const waveEntry = map['scripts/wave-split.mjs'].map(p => p.replace(/\\/g, '/'));
    assert.ok(
      waveEntry.some(p => p.endsWith('scripts/beta-test.mjs')),
      'beta-test.mjs listed for wave-split.mjs',
    );
    assert.equal(waveEntry.length, 1, 'only beta-test.mjs covers wave-split.mjs');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(b) test file with no @covers contributes no entries to the map', async () => {
  const root = makeTmpProject();
  try {
    // This test file has no @covers declarations
    writeFile(root, 'scripts/gamma-test.mjs', [
      'import { test } from "node:test";',
      'test("no-covers placeholder", () => {});',
    ].join('\n'));

    const map = await buildCoversMap(root);

    // The map should be empty — no @covers means no entries
    assert.deepEqual(map, {}, 'map is empty when no test files have @covers');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
