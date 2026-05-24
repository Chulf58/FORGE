// @covers scripts/lib/preflight.cjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { findMissingDirectDep, runPreflight, makeNpmRunner, resolveNpmTimeout } = require('./preflight.cjs');

// ── makeNpmRunner + resolveNpmTimeout exports (TDD red bar for extraction) ──

test('makeNpmRunner — exported and returns a function', () => {
  assert.equal(typeof makeNpmRunner, 'function', 'makeNpmRunner must be exported');
  const runNpm = makeNpmRunner();
  assert.equal(typeof runNpm, 'function', 'makeNpmRunner() must return a function');
});

test('resolveNpmTimeout — exported and respects env override', () => {
  assert.equal(typeof resolveNpmTimeout, 'function', 'resolveNpmTimeout must be exported');
  const prev = process.env.FORGE_NPM_INSTALL_TIMEOUT_MS;
  try {
    delete process.env.FORGE_NPM_INSTALL_TIMEOUT_MS;
    assert.equal(resolveNpmTimeout(), 600000, 'default is 600000ms (10 min)');
    process.env.FORGE_NPM_INSTALL_TIMEOUT_MS = '12345';
    assert.equal(resolveNpmTimeout(), 12345, 'env override is respected');
  } finally {
    if (prev === undefined) delete process.env.FORGE_NPM_INSTALL_TIMEOUT_MS;
    else process.env.FORGE_NPM_INSTALL_TIMEOUT_MS = prev;
  }
});

function makeTmp() {
  return mkdtempSync(join(tmpdir(), 'forge-preflight-test-'));
}

// ── findMissingDirectDep ──────────────────────────────────────────────────

test('findMissingDirectDep — missing dep returns dep name', () => {
  const tmp = makeTmp();
  try {
    const pkgPath = join(tmp, 'package.json');
    const nmDir = join(tmp, 'node_modules');
    writeFileSync(pkgPath, JSON.stringify({ dependencies: { 'zod': '^3.25.0' } }));
    // node_modules exists but zod/ does NOT exist
    mkdirSync(nmDir, { recursive: true });
    assert.equal(
      findMissingDirectDep(pkgPath, nmDir),
      'zod',
      'returns dep name when dep directory is absent',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('findMissingDirectDep — healthy returns null', () => {
  const tmp = makeTmp();
  try {
    const pkgPath = join(tmp, 'package.json');
    const nmDir = join(tmp, 'node_modules');
    writeFileSync(pkgPath, JSON.stringify({ dependencies: { 'zod': '^3.25.0' } }));
    const zodDir = join(nmDir, 'zod');
    mkdirSync(zodDir, { recursive: true });
    // dep dir exists AND has package.json inside — fully healthy
    writeFileSync(join(zodDir, 'package.json'), JSON.stringify({ name: 'zod', version: '3.25.0' }));
    assert.equal(
      findMissingDirectDep(pkgPath, nmDir),
      null,
      'returns null when all deps have directories with package.json',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('findMissingDirectDep — ghost directory (dir exists, no package.json) returns dep name', () => {
  const tmp = makeTmp();
  try {
    const pkgPath = join(tmp, 'package.json');
    const nmDir = join(tmp, 'node_modules');
    writeFileSync(pkgPath, JSON.stringify({ dependencies: { 'zod': '^3.25.0' } }));
    // ghost directory: dir exists but no package.json inside
    mkdirSync(join(nmDir, 'zod'), { recursive: true });
    assert.equal(
      findMissingDirectDep(pkgPath, nmDir),
      'zod',
      'returns dep name when directory exists but has no package.json (ghost directory)',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── runPreflight ──────────────────────────────────────────────────────────

test('runPreflight — calls runNpm and returns depName when dep missing', () => {
  const tmp = makeTmp();
  try {
    const forgeCorePath = tmp;
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: { 'zod': '^3.25.0' } }));
    // node_modules absent — zod missing

    let npmCalled = false;
    let npmArgs = null;
    let npmCwd = null;
    const stubRunNpm = (args, cwd) => {
      npmCalled = true;
      npmArgs = args;
      npmCwd = cwd;
      // Simulate successful install by creating node_modules/zod/package.json
      const zodDir = join(cwd, 'node_modules', 'zod');
      mkdirSync(zodDir, { recursive: true });
      writeFileSync(join(zodDir, 'package.json'), JSON.stringify({ name: 'zod', version: '3.25.0' }));
    };

    const result = runPreflight(forgeCorePath, stubRunNpm);
    assert.ok(npmCalled, 'runNpm must be called when a dep is missing');
    assert.deepEqual(npmArgs, ['install'], 'runNpm called with [install]');
    assert.equal(npmCwd, forgeCorePath, 'runNpm called with forgeCorePath as cwd');
    assert.equal(result.depName, 'zod', 'result.depName is the missing dep');
    assert.equal(result.error, null, 'result.error is null on success');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('runPreflight — failure path: stderr contains dep name, path, and npm install', () => {
  const tmp = makeTmp();
  try {
    const forgeCorePath = tmp;
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: { 'zod': '^3.25.0' } }));
    // node_modules absent — zod missing

    const npmError = new Error('npm install failed: EPERM');
    const stubRunNpm = () => { throw npmError; };

    // Capture stderr
    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return origWrite(chunk, ...rest);
    };

    let result;
    try {
      result = runPreflight(forgeCorePath, stubRunNpm);
    } finally {
      process.stderr.write = origWrite;
    }

    const stderrOutput = stderrChunks.join('');
    assert.ok(stderrOutput.includes('zod'), 'stderr must contain the missing dep name');
    assert.ok(stderrOutput.includes(forgeCorePath), 'stderr must contain the forgeCorePath');
    assert.ok(stderrOutput.includes('npm install'), 'stderr must contain "npm install"');
    assert.ok(result.error === npmError, 'result.error must be the thrown error');
    assert.equal(result.depName, 'zod', 'result.depName must be the missing dep');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('runPreflight — returns null depName when all deps healthy', () => {
  const tmp = makeTmp();
  try {
    const forgeCorePath = tmp;
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: { 'zod': '^3.25.0' } }));
    const zodDir = join(tmp, 'node_modules', 'zod');
    mkdirSync(zodDir, { recursive: true });
    writeFileSync(join(zodDir, 'package.json'), JSON.stringify({ name: 'zod', version: '3.25.0' }));

    let npmCalled = false;
    const stubRunNpm = () => { npmCalled = true; };

    const result = runPreflight(forgeCorePath, stubRunNpm);
    assert.ok(!npmCalled, 'runNpm must NOT be called when all deps are healthy');
    assert.equal(result.depName, null, 'result.depName is null when healthy');
    assert.equal(result.error, null, 'result.error is null when healthy');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
