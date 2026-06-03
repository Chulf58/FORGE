// @covers hooks/cache-drift-guard.js
//
// Tests for the `computeDriftWarning` pure function.
// Uses createRequire for reliable CJS interop — named ESM import of a CJS
// module can resolve undefined; createRequire is the safe path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// This require call fires at module load. When cache-drift-guard.js does not
// yet exist, it throws MODULE_NOT_FOUND and the process exits non-zero — this
// is the AC-1 red bar (import failure counts as red per the plan).
const require = createRequire(import.meta.url);
const { computeDriftWarning } = require('./cache-drift-guard.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a temporary project directory for testing.
 * When pluginJsonContent is provided, writes it to .claude-plugin/plugin.json.
 * When omitted, the directory has no plugin.json (simulates absent file).
 */
async function makeTempProjectDir(pluginJsonContent) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-drift-guard-test-'));
  if (pluginJsonContent !== undefined) {
    await fs.mkdir(path.join(dir, '.claude-plugin'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify(pluginJsonContent),
      'utf8',
    );
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Tests — AC-2: any stub returning null will fail on the drift-detected case
// ---------------------------------------------------------------------------

test('drift detected: returns warning containing both versions and fix steps', async () => {
  const dir = await makeTempProjectDir({ version: '0.6.5' });
  try {
    // pluginRoot basename is '0.6.7' (loaded cache version)
    // plugin.json says '0.6.5' (working-tree version)
    const pluginRoot = path.join('/fake', 'cache', '0.6.7');
    const result = computeDriftWarning(pluginRoot, dir);
    assert.ok(
      typeof result === 'string',
      'must return a warning string when cache version differs from plugin.json version',
    );
    assert.ok(result.includes('0.6.7'), 'warning must name the cache version (0.6.7)');
    assert.ok(result.includes('0.6.5'), 'warning must name the working-tree version (0.6.5)');
    assert.ok(result.includes('/plugin'), 'warning must include the /plugin fix step');
    assert.ok(result.includes('/reload-plugins'), 'warning must include the /reload-plugins fix step');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('equal versions: returns null', async () => {
  const dir = await makeTempProjectDir({ version: '0.6.7' });
  try {
    const pluginRoot = path.join('/fake', 'cache', '0.6.7');
    const result = computeDriftWarning(pluginRoot, dir);
    assert.strictEqual(result, null, 'must return null when cache version equals plugin.json version');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('no plugin.json: returns null', async () => {
  // Directory exists but no .claude-plugin/plugin.json written
  const dir = await makeTempProjectDir();
  try {
    const pluginRoot = path.join('/fake', 'cache', '0.6.7');
    const result = computeDriftWarning(pluginRoot, dir);
    assert.strictEqual(result, null, 'must return null when plugin.json is absent');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('present but versionless plugin.json (empty object): returns null', async () => {
  // plugin.json exists but has no 'version' field — must NOT produce a warning
  // naming 'undefined' vs the cache version
  const dir = await makeTempProjectDir({});
  try {
    const pluginRoot = path.join('/fake', 'cache', '0.6.7');
    const result = computeDriftWarning(pluginRoot, dir);
    assert.strictEqual(
      result,
      null,
      'must return null when plugin.json has no version field — must NOT warn about undefined',
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('present but non-string version in plugin.json: returns null', async () => {
  // version field is a number, not a string
  const dir = await makeTempProjectDir({ version: 42 });
  try {
    const pluginRoot = path.join('/fake', 'cache', '0.6.7');
    const result = computeDriftWarning(pluginRoot, dir);
    assert.strictEqual(
      result,
      null,
      'must return null for non-string version field — must NOT compare against 42',
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('unset pluginRoot (null): returns null', () => {
  const result = computeDriftWarning(null, '/any/project/path');
  assert.strictEqual(result, null, 'must return null for null pluginRoot (defensive contract)');
});

test('empty string pluginRoot: returns null', () => {
  const result = computeDriftWarning('', '/any/project/path');
  assert.strictEqual(result, null, 'must return null for empty string pluginRoot');
});

test('non-semver cache path (local dev-install): returns null', async () => {
  // pluginRoot basename is 'forge-plugin', not a semver — typical local dev-install path
  const dir = await makeTempProjectDir({ version: '0.6.7' });
  try {
    const pluginRoot = path.join('/home', 'user', 'dev', 'forge-plugin');
    const result = computeDriftWarning(pluginRoot, dir);
    assert.strictEqual(
      result,
      null,
      'must return null when pluginRoot basename does not match /^\\d+\\.\\d+\\.\\d+/ (non-semver path)',
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('error safety: non-existent projectDir returns null without throwing', () => {
  const pluginRoot = path.join('/fake', 'cache', '0.6.7');
  // Simulate fs.readFileSync throwing by pointing at a path that cannot exist
  const nonExistentDir = path.join(os.tmpdir(), 'does-not-exist-' + Date.now() + '-' + Math.random());
  let result;
  assert.doesNotThrow(
    () => { result = computeDriftWarning(pluginRoot, nonExistentDir); },
    'must not throw when plugin.json is unreadable (e.g. ENOENT)',
  );
  assert.strictEqual(result, null, 'must return null when plugin.json read fails');
});
