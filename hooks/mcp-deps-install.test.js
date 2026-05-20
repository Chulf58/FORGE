// @covers hooks/mcp-deps-install.js
'use strict';
// TDD guard entry-point for hooks/mcp-deps-install.js.
// Full test coverage lives in mcp-deps-install-failure-preservation-test.js.
// This file exists so the TDD guard's resolveTestFile() can locate a .test.js
// for the source module. The assertions here mirror the failure-preservation
// tests — they fail before Wave 2 fixes and pass after.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const mod = require('./mcp-deps-install.js');

test('resolveNpmTimeout — exported', () => {
  assert.equal(typeof mod.resolveNpmTimeout, 'function',
    'resolveNpmTimeout must be exported');
});

test('_runNpmCatch — exported', () => {
  assert.equal(typeof mod._runNpmCatch, 'function',
    '_runNpmCatch must be exported');
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forge-deps-check-'));
}

test('findMissingDirectDep — exported', () => {
  assert.equal(typeof mod.findMissingDirectDep, 'function',
    'findMissingDirectDep must be exported so partial-corruption detection is testable');
});

test('findMissingDirectDep — returns null when every direct dep has a directory', () => {
  const tmp = makeTmp();
  try {
    const pkgPath = path.join(tmp, 'package.json');
    const nmDir = path.join(tmp, 'node_modules');
    fs.writeFileSync(pkgPath, JSON.stringify({ dependencies: { 'foo': '^1.0.0', '@scope/bar': '^2.0.0' } }));
    fs.mkdirSync(path.join(nmDir, 'foo'), { recursive: true });
    fs.mkdirSync(path.join(nmDir, '@scope', 'bar'), { recursive: true });
    assert.equal(mod.findMissingDirectDep(pkgPath, nmDir), null,
      'returns null when all declared deps are present in node_modules');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('findMissingDirectDep — returns missing dep name when one subtree is gone', () => {
  const tmp = makeTmp();
  try {
    const pkgPath = path.join(tmp, 'package.json');
    const nmDir = path.join(tmp, 'node_modules');
    fs.writeFileSync(pkgPath, JSON.stringify({ dependencies: { 'foo': '^1.0.0', '@anthropic-ai/claude-agent-sdk': '^0.2.0' } }));
    fs.mkdirSync(path.join(nmDir, 'foo'), { recursive: true });
    // @anthropic-ai/claude-agent-sdk dir is deliberately absent — mirrors the
    // r-1a0dc217 incident where node_modules existed but the SDK subtree was gone.
    assert.equal(mod.findMissingDirectDep(pkgPath, nmDir), '@anthropic-ai/claude-agent-sdk',
      'returns the scoped package name when its directory is missing');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('findMissingDirectDep — returns null on unreadable package.json (fail-open)', () => {
  const tmp = makeTmp();
  try {
    const nmDir = path.join(tmp, 'node_modules');
    fs.mkdirSync(nmDir, { recursive: true });
    const result = mod.findMissingDirectDep(path.join(tmp, 'missing.json'), nmDir);
    assert.equal(result, null,
      'fail-open on read errors — partial-corruption check must not block hook progress');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Wave 2 gate: these tests fail before scanCacheVersions is implemented ───

test('scanCacheVersions — exported by hooks/mcp-deps-install.js', () => {
  assert.equal(typeof mod.scanCacheVersions, 'function',
    'scanCacheVersions must be exported');
});

// AC-5a oracle: source must never match npm.*(install|ci).*claude-agent-sdk —
// verifies no code path passes the SDK name as an npm install target.
// Comments in source must not contain this pattern either (to keep oracle clean).
test('AC-5a: no npm install invocation targets @anthropic-ai/claude-agent-sdk', () => {
  const src = fs.readFileSync(path.join(__dirname, 'mcp-deps-install.js'), 'utf8');
  const match = src.match(/npm.*(install|ci).*claude-agent-sdk/);
  assert.ok(!match,
    'Source must not contain npm.*(install|ci).*claude-agent-sdk; found: ' + (match ? match[0] : ''));
});
