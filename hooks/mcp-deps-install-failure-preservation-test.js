#!/usr/bin/env node
'use strict';
// Failure-preservation tests for hooks/mcp-deps-install.js (f98719b6).
// Establishes the red bar for two bugs before Wave 2 fixes are applied.
// Run: node hooks/mcp-deps-install-failure-preservation-test.js
// Auto-discovered by scripts/run-tests.mjs via hooks/*-test.js suffix.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mod = require('./mcp-deps-install.js');

test('resolveNpmTimeout — exported by hooks/mcp-deps-install.js', () => {
  assert.equal(typeof mod.resolveNpmTimeout, 'function',
    'resolveNpmTimeout must be exported for test access');
});

test('resolveNpmTimeout — returns 600000ms by default (no env override)', () => {
  delete process.env.FORGE_NPM_INSTALL_TIMEOUT_MS;
  const result = mod.resolveNpmTimeout();
  assert.equal(result, 600000,
    'default timeout must be 600000ms when FORGE_NPM_INSTALL_TIMEOUT_MS is unset');
});

test('resolveNpmTimeout — honours FORGE_NPM_INSTALL_TIMEOUT_MS env override', () => {
  process.env.FORGE_NPM_INSTALL_TIMEOUT_MS = '120000';
  try {
    const result = mod.resolveNpmTimeout();
    assert.equal(result, 120000,
      'timeout must reflect FORGE_NPM_INSTALL_TIMEOUT_MS env override');
  } finally {
    delete process.env.FORGE_NPM_INSTALL_TIMEOUT_MS;
  }
});

test('_runNpmCatch — exported by hooks/mcp-deps-install.js', () => {
  assert.equal(typeof mod._runNpmCatch, 'function',
    '_runNpmCatch must be exported for test access');
});

test('node_modules survives simulated npm failure (rmSync must not be called)', () => {
  const tmpDir = path.join(os.tmpdir(), 'forge-mcp-test-' + Date.now());
  const fakeNm = path.join(tmpDir, 'node_modules');
  fs.mkdirSync(fakeNm, { recursive: true });
  try {
    mod._runNpmCatch('test-pkg', fakeNm, new Error('simulated npm ci failure'));
    assert.ok(fs.existsSync(fakeNm),
      'node_modules must NOT be deleted when npm fails — rmSync must be removed from catch handler');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
