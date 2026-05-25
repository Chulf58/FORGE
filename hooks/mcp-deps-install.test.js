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

test('findMissingDirectDep — returns null when every direct dep has a directory with package.json', () => {
  const tmp = makeTmp();
  try {
    const pkgPath = path.join(tmp, 'package.json');
    const nmDir = path.join(tmp, 'node_modules');
    fs.writeFileSync(pkgPath, JSON.stringify({ dependencies: { 'foo': '^1.0.0', '@scope/bar': '^2.0.0' } }));
    // Each dep must have a package.json inside — bare directories are NOT considered valid
    const fooDir = path.join(nmDir, 'foo');
    const barDir = path.join(nmDir, '@scope', 'bar');
    fs.mkdirSync(fooDir, { recursive: true });
    fs.mkdirSync(barDir, { recursive: true });
    fs.writeFileSync(path.join(fooDir, 'package.json'), JSON.stringify({ name: 'foo', version: '1.0.0' }));
    fs.writeFileSync(path.join(barDir, 'package.json'), JSON.stringify({ name: '@scope/bar', version: '2.0.0' }));
    assert.equal(mod.findMissingDirectDep(pkgPath, nmDir), null,
      'returns null when all declared deps have a directory with package.json');
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
    // foo has a valid directory + package.json — it's healthy
    const fooDir = path.join(nmDir, 'foo');
    fs.mkdirSync(fooDir, { recursive: true });
    fs.writeFileSync(path.join(fooDir, 'package.json'), JSON.stringify({ name: 'foo', version: '1.0.0' }));
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

// Regression test for TODO 6e7e7f34: hook failed to repair packages/forge-core/node_modules/zod
// when the zod/ DIRECTORY existed but was empty (no package.json inside).
// Root cause: findMissingDirectDep only checked fs.existsSync(dir) — not package validity.
// A ghost directory (created by a partial npm install interrupted by EPERM or network) would
// pass the existsSync check, so needsInstall stayed false, and zod was never reinstalled.
// The MCP server then failed with "Cannot find package 'zod'" because Node.js requires
// node_modules/zod/package.json to resolve the package.
test('findMissingDirectDep — returns dep name when dep directory exists but has no package.json (ghost directory)', () => {
  const tmp = makeTmp();
  try {
    const pkgPath = path.join(tmp, 'package.json');
    const nmDir = path.join(tmp, 'node_modules');
    fs.writeFileSync(pkgPath, JSON.stringify({ dependencies: { 'zod': '^3.25.0' } }));
    fs.mkdirSync(path.join(nmDir, 'zod'), { recursive: true }); // directory exists but is EMPTY — no package.json
    assert.equal(mod.findMissingDirectDep(pkgPath, nmDir), 'zod',
      'returns dep name when directory exists but has no package.json — ghost directory must trigger reinstall');
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

// TODO 3d6b7587: npm ci EPERM-unlink corrupts node_modules on Windows when
// file locks are held by other processes. mcp-deps-install.js must never
// use `npm ci` — only `npm install` (incremental, doesn't delete first).
test('TODO 3d6b7587: mcp-deps-install.js uses npm install, never npm ci', () => {
  const src = fs.readFileSync(path.join(__dirname, 'mcp-deps-install.js'), 'utf8');
  // installArgs assignments must not produce ['ci']
  const ciArgsMatch = src.match(/installArgs\s*=\s*[^;]*['"]ci['"]/);
  assert.ok(!ciArgsMatch,
    'installArgs must not be set to [\'ci\']; found: ' + (ciArgsMatch ? ciArgsMatch[0] : '') +
    '. Use [\'install\'] always — see TODO 3d6b7587.');
});

// Launcher generator must target bin/forge-mcp-bootstrap.cjs so the bootstrap
// shim runs FIRST (self-heals mcp/node_modules) before spawning mcp/server.js.
// Pointing the launcher directly at mcp/server.js bypasses self-heal and
// leaves the timing-gap that .gitignore lines 8-26 + the "node_modules SDK
// silently removed" solution doc describe.
test('launcher generator points at bin/forge-mcp-bootstrap.cjs (not mcp/server.js)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'mcp-deps-install.js'), 'utf8');
  // The generator must reference the bootstrap file when building launcherContent.
  assert.ok(
    /forge-mcp-bootstrap\.cjs/.test(src),
    'mcp-deps-install.js must reference forge-mcp-bootstrap.cjs in the launcher generator',
  );
  // And the launcherContent assignment must use the bootstrap path, not the
  // server.js path. We detect this by checking that there's no line where
  // launcherContent is built directly from a 'mcp/server.js' join.
  const directServerPathInLauncher = /launcherContent\s*=\s*[^;]*serverPath/.test(src) &&
    /const\s+serverPath\s*=\s*path\.join\([^)]*['"]server\.js['"]\)/.test(src);
  assert.ok(
    !directServerPathInLauncher,
    'launcherContent must not interpolate serverPath (mcp/server.js) directly — use bootstrapPath',
  );
});
