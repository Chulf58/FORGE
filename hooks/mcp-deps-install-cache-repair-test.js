#!/usr/bin/env node
'use strict';
// Tests for the cache-repair scanCacheVersions function.
// Wave 1 (Task 2): these tests FAIL before scanCacheVersions is exported.
// Wave 2 (Tasks 3, 5): these tests PASS after implementation.
//
// Run: node hooks/mcp-deps-install-cache-repair-test.js
// Auto-discovered by scripts/run-tests.mjs via hooks/*-test.js suffix.
//
// @covers hooks/mcp-deps-install.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mod = require('./mcp-deps-install.js');

// ── AC-2/AC-3: Export existence ─────────────────────────────────────────────

test('scanCacheVersions — exported by hooks/mcp-deps-install.js', () => {
  assert.equal(typeof mod.scanCacheVersions, 'function',
    'scanCacheVersions must be exported for regression-test access');
});

// ── AC-5b: Positive copy test — SDK copied, npm NOT called for SDK ──────────

test('scanCacheVersions — copies SDK from healthy version to broken version without npm', () => {
  // Set up temp cache dir with two version subdirs
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cache-repair-test-'));
  try {
    const v1 = path.join(tmpBase, '0.5.5');
    const v2 = path.join(tmpBase, '0.5.6');
    const v1Mcp = path.join(v1, 'mcp');
    const v2Mcp = path.join(v2, 'mcp');

    // v1: healthy — has node_modules with SDK (including package.json inside the SDK dir)
    const v1SdkDir = path.join(v1Mcp, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
    fs.mkdirSync(v1SdkDir, { recursive: true });
    fs.writeFileSync(path.join(v1SdkDir, 'index.js'), '// stub sdk\n');
    // package.json is required inside the dep directory: findMissingDirectDep now checks
    // both existsSync(dir) AND existsSync(dir/package.json) to detect ghost directories.
    fs.writeFileSync(path.join(v1SdkDir, 'package.json'),
      JSON.stringify({ name: '@anthropic-ai/claude-agent-sdk', version: '1.0.0' }));
    fs.writeFileSync(
      path.join(v1Mcp, 'package.json'),
      JSON.stringify({ dependencies: { '@anthropic-ai/claude-agent-sdk': '^1.0.0' } })
    );

    // v2: broken — has package.json but no node_modules
    fs.mkdirSync(v2Mcp, { recursive: true });
    fs.writeFileSync(
      path.join(v2Mcp, 'package.json'),
      JSON.stringify({ dependencies: { '@anthropic-ai/claude-agent-sdk': '^1.0.0' } })
    );

    // Spy on npm calls — should be zero since SDK is the only dep and is fixed by copy
    let npmCallCount = 0;
    const spyNpm = function(args, cwd) {
      npmCallCount++;
    };

    // Run scanCacheVersions with injected npm spy
    mod.scanCacheVersions(tmpBase, { _runNpm: spyNpm });

    // AC-5b assertion 1: SDK was copied to v2
    const v2SdkDir = path.join(v2Mcp, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
    assert.ok(fs.existsSync(v2SdkDir),
      'SDK must exist in v2 node_modules after repair; got: ' + v2SdkDir);

    // AC-5b assertion 2: npm was NOT called (SDK was only missing dep, fixed by copy)
    assert.equal(npmCallCount, 0,
      'npm must not be called when SDK is the only missing dep and is fixed by copy; got ' + npmCallCount + ' npm call(s)');
  } finally {
    // Clean up temp dir
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (_) {}
  }
});

test('scanCacheVersions — no-op when cacheBaseDir does not exist', () => {
  // Should not throw
  assert.doesNotThrow(() => {
    mod.scanCacheVersions(path.join(os.tmpdir(), 'forge-nonexistent-cache-' + Date.now()));
  }, 'scanCacheVersions must be fail-open when cacheBaseDir does not exist');
});

test('scanCacheVersions — no-op when all versions are healthy', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cache-healthy-test-'));
  try {
    const v1 = path.join(tmpBase, '0.5.5');
    const v1Mcp = path.join(v1, 'mcp');

    // v1: healthy — SDK directory must include package.json to be considered valid
    const v1SdkDir = path.join(v1Mcp, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
    fs.mkdirSync(v1SdkDir, { recursive: true });
    fs.writeFileSync(path.join(v1SdkDir, 'package.json'),
      JSON.stringify({ name: '@anthropic-ai/claude-agent-sdk', version: '1.0.0' }));
    fs.writeFileSync(path.join(v1Mcp, 'package.json'),
      JSON.stringify({ dependencies: { '@anthropic-ai/claude-agent-sdk': '^1.0.0' } }));

    let npmCallCount = 0;
    const spyNpm = function() { npmCallCount++; };
    mod.scanCacheVersions(tmpBase, { _runNpm: spyNpm });

    assert.equal(npmCallCount, 0, 'npm must not be called when all versions are healthy');
  } finally {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (_) {}
  }
});
