#!/usr/bin/env node
// Lightweight runner for FORGE's script-style regression tests.
//
// Discovers tests by convention:
//   hooks/*-test.js    (CommonJS, no deps beyond Node built-ins)
//   mcp/*-test.mjs     (ESM, may require mcp/node_modules)
//
// Runs each file sequentially via `node <path>` from the repo root.
// Each test's own stdout/stderr is inherited so live output stays visible.
// After all tests run, prints a one-line-per-test summary and exits 0 only
// when every test exited 0. Any non-zero exit → runner exits non-zero.
//
// Run: node scripts/run-tests.mjs

import { readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const TEST_LOCATIONS = [
  { dir: 'hooks',    suffix: '-test.js' },
  { dir: 'hooks',    suffix: '-test.mjs' },
  { dir: 'mcp',      suffix: '-test.mjs' },
  { dir: 'mcp/lib',  suffix: '-test.mjs' },
  { dir: 'scripts',  suffix: '-test.mjs' },
  { dir: 'mcp/lib/tools',        suffix: '.test.mjs' },
  { dir: 'mcp/lib/orchestrator', suffix: '.test.mjs' },
];

function discover() {
  const found = [];
  for (const { dir, suffix } of TEST_LOCATIONS) {
    const abs = join(REPO_ROOT, dir);
    if (!existsSync(abs)) continue;
    const entries = readdirSync(abs);
    for (const name of entries) {
      if (!name.endsWith(suffix)) continue;
      found.push(join(abs, name));
    }
  }
  return found.sort();
}

function runOne(absPath) {
  return new Promise((resolve) => {
    const rel = relative(REPO_ROOT, absPath).replace(/\\/g, '/');
    console.log('');
    console.log('── ' + rel + ' ' + '─'.repeat(Math.max(0, 72 - rel.length - 4)));
    const started = Date.now();
    const child = spawn(process.execPath, [absPath], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      resolve({ path: rel, code: code == null ? 1 : code, ms: Date.now() - started });
    });
    child.on('error', (err) => {
      console.error('[run-tests] spawn error for ' + rel + ': ' + err.message);
      resolve({ path: rel, code: 1, ms: Date.now() - started });
    });
  });
}

async function main() {
  const files = discover();
  if (files.length === 0) {
    console.log('[run-tests] no test files discovered — nothing to do.');
    process.exit(0);
  }

  console.log('[run-tests] running ' + files.length + ' test file(s) from ' + REPO_ROOT);
  const results = [];
  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await runOne(f));
  }

  console.log('');
  console.log('─── summary ─────────────────────────────────────────────────────────────');
  let failed = 0;
  for (const r of results) {
    const verdict = r.code === 0 ? 'PASS' : 'FAIL';
    if (r.code !== 0) failed++;
    console.log('  ' + verdict + '  ' + r.path + '   (' + r.ms + 'ms)');
  }
  const total = results.length;
  const passed = total - failed;
  console.log('─────────────────────────────────────────────────────────────────────────');
  console.log('  ' + passed + '/' + total + ' passed' + (failed ? ', ' + failed + ' failed' : ''));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[run-tests] unexpected error:', err);
  process.exit(1);
});
