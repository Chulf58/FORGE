#!/usr/bin/env node
// Tests for verify-critic-citations.mjs
// Uses node:test + node:assert. Run via: node scripts/verify-critic-citations-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./verify-critic-citations.mjs', import.meta.url));

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'critic-verify-test-'));
}

function writeJson(dir, relPath, obj) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(obj, null, 2), 'utf8');
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function runScript(rootDir) {
  try {
    execFileSync(process.execPath, [SCRIPT, '--root', rootDir], { encoding: 'utf8' });
    return { code: 0 };
  } catch (err) {
    return { code: err.status ?? 1, stderr: err.stderr ?? '' };
  }
}

function readVerified(dir) {
  const p = path.join(dir, 'docs', 'context', 'critic-verified.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// --- Tests -------------------------------------------------------------------

test('exits 0 and writes verified.json when all citations pass', () => {
  const dir = makeTmpDir();
  writeFile(dir, 'src/main.js', 'function foo() {\n  return 42;\n}\n');
  writeJson(dir, 'docs/context/critic-findings.json', {
    findings: [
      {
        severity: 'HIGH',
        lens: 'fragility',
        title: 'foo returns hardcoded value',
        description: 'src/main.js:foo returns a hardcoded 42',
        file: 'src/main.js',
        citations: [
          { file: 'src/main.js', lines: '2', evidence: 'return 42;' },
        ],
      },
    ],
    completedLenses: ['fragility'],
    status: 'complete',
  });

  const result = runScript(dir);
  assert.equal(result.code, 0, 'exit code should be 0');

  const verified = readVerified(dir);
  assert.ok(verified, 'critic-verified.json should exist');
  assert.equal(verified.findings.length, 1, 'one finding should survive');
  assert.equal(verified.findings[0].title, 'foo returns hardcoded value');
});

test('exits 1 and drops finding when evidence not in source', () => {
  const dir = makeTmpDir();
  writeFile(dir, 'src/main.js', 'function foo() {\n  return 42;\n}\n');
  writeJson(dir, 'docs/context/critic-findings.json', {
    findings: [
      {
        severity: 'MEDIUM',
        lens: 'technical-debt',
        title: 'fabricated finding',
        description: 'does not exist in the file',
        file: 'src/main.js',
        citations: [
          { file: 'src/main.js', lines: '1-2', evidence: 'this text is not in the file' },
        ],
      },
    ],
    completedLenses: ['technical-debt'],
    status: 'complete',
  });

  const result = runScript(dir);
  assert.equal(result.code, 1, 'exit code should be 1 when no findings survive');

  const verified = readVerified(dir);
  assert.ok(verified, 'critic-verified.json should still be written');
  assert.equal(verified.findings.length, 0, 'zero findings should survive');
});

test('exits 1 and drops finding when no citations array', () => {
  const dir = makeTmpDir();
  writeFile(dir, 'src/main.js', 'const x = 1;\n');
  writeJson(dir, 'docs/context/critic-findings.json', {
    findings: [
      {
        severity: 'LOW',
        lens: 'technical-debt',
        title: 'uncited finding',
        description: 'no citations provided',
        file: 'src/main.js',
      },
    ],
    completedLenses: ['technical-debt'],
    status: 'complete',
  });

  const result = runScript(dir);
  assert.equal(result.code, 1);

  const verified = readVerified(dir);
  assert.ok(verified, 'critic-verified.json should be written');
  assert.equal(verified.findings.length, 0);
});

test('exits 1 when line range is out of bounds', () => {
  const dir = makeTmpDir();
  writeFile(dir, 'src/main.js', 'const x = 1;\n');
  writeJson(dir, 'docs/context/critic-findings.json', {
    findings: [
      {
        severity: 'LOW',
        lens: 'fragility',
        title: 'out of bounds citation',
        description: 'claims line 999 exists',
        file: 'src/main.js',
        citations: [
          { file: 'src/main.js', lines: '999', evidence: 'const x = 1;' },
        ],
      },
    ],
    completedLenses: ['fragility'],
    status: 'complete',
  });

  const result = runScript(dir);
  assert.equal(result.code, 1);
});

test('exits 1 when cited file does not exist', () => {
  const dir = makeTmpDir();
  writeJson(dir, 'docs/context/critic-findings.json', {
    findings: [
      {
        severity: 'HIGH',
        lens: 'security-safety',
        title: 'nonexistent file citation',
        description: 'points to a file that is not there',
        file: 'src/ghost.js',
        citations: [
          { file: 'src/ghost.js', lines: '1', evidence: 'anything' },
        ],
      },
    ],
    completedLenses: ['security-safety'],
    status: 'complete',
  });

  const result = runScript(dir);
  assert.equal(result.code, 1);
});

test('passes verified finding and drops failed one in mixed batch', () => {
  const dir = makeTmpDir();
  writeFile(dir, 'src/main.js', 'function foo() {\n  return 42;\n}\n');
  writeJson(dir, 'docs/context/critic-findings.json', {
    findings: [
      {
        severity: 'HIGH',
        lens: 'fragility',
        title: 'good finding',
        description: 'real citation',
        file: 'src/main.js',
        citations: [{ file: 'src/main.js', lines: '2', evidence: 'return 42;' }],
      },
      {
        severity: 'LOW',
        lens: 'fragility',
        title: 'bad finding',
        description: 'fabricated citation',
        file: 'src/main.js',
        citations: [{ file: 'src/main.js', lines: '1', evidence: 'fabricated text XYZ' }],
      },
    ],
    completedLenses: ['fragility'],
    status: 'complete',
  });

  const result = runScript(dir);
  assert.equal(result.code, 0, 'at least one finding survived');

  const verified = readVerified(dir);
  assert.equal(verified.findings.length, 1);
  assert.equal(verified.findings[0].title, 'good finding');
});

test('whitespace normalization: evidence with collapsed whitespace matches', () => {
  const dir = makeTmpDir();
  // File has indented content with extra spaces; evidence uses normalized form
  writeFile(dir, 'src/main.js', 'function foo() {\n    return    42;\n}\n');
  writeJson(dir, 'docs/context/critic-findings.json', {
    findings: [
      {
        severity: 'MEDIUM',
        lens: 'technical-debt',
        title: 'ws normalize test',
        description: 'evidence uses single-space form',
        file: 'src/main.js',
        citations: [
          // Source has "    return    42;" — normalized: "return 42;"
          { file: 'src/main.js', lines: '2', evidence: 'return 42;' },
        ],
      },
    ],
    completedLenses: ['technical-debt'],
    status: 'complete',
  });

  const result = runScript(dir);
  assert.equal(result.code, 0, 'normalized evidence should match');
});
