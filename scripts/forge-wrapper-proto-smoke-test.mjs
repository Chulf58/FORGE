#!/usr/bin/env node
// Smoke test: forge-wrapper-proto.mjs must load its deps (node-pty, blessed)
// without crashing, detect non-TTY stdio, emit the expected fallback message,
// and exit cleanly with code 0.
//
// We cannot test the interactive path from the harness — blessed + node-pty
// require a real TTY, same limitation as forge-tui.mjs. This test catches
// dependency-load regressions, syntax errors, and the TTY-fallback path.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO = resolve(__dirname, 'forge-wrapper-proto.mjs');

function fail(msg) {
  console.error('[forge-wrapper-proto-smoke] FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

async function main() {
  const proc = spawn(process.execPath, [PROTO], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],   // no TTY on any stream
  });

  let stderr = '';
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', d => { stderr += d; });

  const exitCode = await new Promise((r, rej) => {
    const t = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      rej(new Error('wrapper prototype did not exit within 5s'));
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

  console.log('[forge-wrapper-proto-smoke] PASS');
  console.log('  deps loaded (node-pty + blessed)');
  console.log('  non-TTY detected, fallback path took effect');
  console.log('  exit code 0');
}

main().catch(err => {
  console.error('[forge-wrapper-proto-smoke] unexpected throw:', err);
  process.exit(1);
});
