#!/usr/bin/env node
// Smoke test: forge-observer-proto.mjs must load its deps (blessed +
// dashboard-state), detect non-TTY stdio, emit the expected fallback
// message, and exit cleanly with code 0.
//
// The interactive path is not tested here — blessed requires a real TTY,
// same limitation as the wrapper smoke test. This test catches dependency-
// load regressions, module-parse errors, and the TTY-fallback path.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OBSERVER = resolve(__dirname, 'forge-observer-proto.mjs');

function fail(msg) {
  console.error('[forge-observer-proto-smoke] FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

async function main() {
  const proc = spawn(process.execPath, [OBSERVER], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],   // no TTY on any stream
  });

  let stderr = '';
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', d => { stderr += d; });

  const exitCode = await new Promise((r, rej) => {
    const t = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      rej(new Error('observer prototype did not exit within 5s'));
    }, 5000);
    proc.on('exit', code => { clearTimeout(t); r(code); });
    proc.on('error', err => { clearTimeout(t); rej(err); });
  });

  if (exitCode !== 0) {
    fail('expected exit 0 in non-TTY fallback path, got ' + exitCode + '. stderr: ' + stderr);
  }
  if (!/not a TTY/i.test(stderr)) {
    fail('expected "not a TTY" in stderr, got: ' + stderr);
  }

  console.log('[forge-observer-proto-smoke] PASS');
  console.log('  deps loaded (blessed + dashboard-state)');
  console.log('  non-TTY detected, fallback path took effect');
  console.log('  exit code 0');
}

main().catch(err => {
  console.error('[forge-observer-proto-smoke] unexpected throw:', err);
  process.exit(1);
});
