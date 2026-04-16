#!/usr/bin/env node
// Smoke test: forge-observer-ink-spike.mjs must load its deps (ink +
// react + dashboard-state), detect non-TTY stdio, emit the expected
// fallback message, and exit cleanly with code 0.
//
// Mirrors forge-observer-proto-smoke-test.mjs in shape — the interactive
// path requires a real TTY and isn't tested here. This catches dep-load
// regressions, import errors, and the non-TTY fallback path.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPIKE = resolve(__dirname, 'forge-observer-ink-spike.mjs');

function fail(msg) {
  console.error('[forge-observer-ink-spike-smoke] FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

async function main() {
  const proc = spawn(process.execPath, [SPIKE], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', d => { stderr += d; });

  const exitCode = await new Promise((r, rej) => {
    const t = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      rej(new Error('ink spike did not exit within 5s'));
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

  console.log('[forge-observer-ink-spike-smoke] PASS');
  console.log('  deps loaded (ink + react + dashboard-state)');
  console.log('  non-TTY detected, fallback path took effect');
  console.log('  exit code 0');
}

main().catch(err => {
  console.error('[forge-observer-ink-spike-smoke] unexpected throw:', err);
  process.exit(1);
});
