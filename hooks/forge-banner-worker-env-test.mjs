#!/usr/bin/env node
// @covers hooks/forge-banner.js
//
// forge-banner has no worker-session guard, so it injects "FORGE plugin is
// active / available commands" additionalContext into EVERY SessionStart —
// including orchestrator-dispatched agent sessions, where it reinforces the
// conductor framing that stops agents from doing their work (run r-de1491f6).
//
// Fix: suppress the banner output when FORGE_WORKER_SESSION=1 (inherited by
// hook child-processes from forge-worker.mjs:481). Normal conductor sessions
// (no such env var) still get the banner context.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = resolve(__dirname, 'forge-banner.js');
const PLUGIN_ROOT = resolve(__dirname, '..');

function runHook(payload, cwd, env) {
  return new Promise((resolveP, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      cwd,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    child.on('close', (code) => resolveP({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on('error', reject);
  });
}

function additionalContextOf(stdout) {
  if (!stdout) return null;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j && j.hookSpecificOutput && typeof j.hookSpecificOutput.additionalContext === 'string') {
        return j.hookSpecificOutput.additionalContext;
      }
    } catch (_) { /* not a JSON line — skip */ }
  }
  return null;
}

test('forge-banner is SILENT (no additionalContext) when FORGE_WORKER_SESSION=1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-banner-worker-'));
  try {
    const res = await runHook({}, dir, { FORGE_WORKER_SESSION: '1' });
    assert.equal(
      additionalContextOf(res.stdout),
      null,
      'must NOT inject "FORGE plugin is active" context into a worker-dispatched agent (stdout: ' + res.stdout + ')',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('forge-banner emits plugin-active context in a normal session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-banner-conductor-'));
  try {
    const res = await runHook({}, dir, { FORGE_WORKER_SESSION: '' });
    const ctx = additionalContextOf(res.stdout);
    assert.ok(
      ctx && ctx.includes('FORGE plugin is active'),
      'normal session must still receive the banner context (stdout: ' + res.stdout + ')',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
