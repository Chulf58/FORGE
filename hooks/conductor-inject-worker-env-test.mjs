#!/usr/bin/env node
// @covers hooks/conductor-inject.js
//
// Tests that conductor-inject suppresses its conductor control-plane context
// when FORGE_WORKER_SESSION=1, and injects it normally otherwise.
//
// Background (root cause, run r-de1491f6): the deterministic orchestrator
// dispatches each agent via the SDK query() with the full FORGE plugin loaded,
// so conductor-inject fired INSIDE every dispatched agent's session and framed
// it as "the control plane". The agents then commented instead of coding and
// wrote zero output. A worktree-local marker cannot fix this because
// resolveProjectDir strips the `.worktrees/r-<id>` suffix and resolves to MAIN.
// forge-worker.mjs sets process.env.FORGE_WORKER_SESSION='1' before dispatch
// (forge-worker.mjs:481); hook child-processes inherit it. The conductor
// session never sets it — so it is the reliable worker-session signal.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = resolve(__dirname, 'conductor-inject.js');
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

test('conductor-inject is SILENT when FORGE_WORKER_SESSION=1 (dispatched agent)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cond-inject-worker-'));
  try {
    const res = await runHook({}, dir, { FORGE_WORKER_SESSION: '1' });
    assert.equal(
      additionalContextOf(res.stdout),
      null,
      'must NOT inject conductor context into a worker-dispatched agent (stdout: ' + res.stdout + ')',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('conductor-inject INJECTS control-plane context in a normal conductor session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cond-inject-conductor-'));
  try {
    const res = await runHook({}, dir, { FORGE_WORKER_SESSION: '' });
    const ctx = additionalContextOf(res.stdout);
    assert.ok(
      ctx && ctx.includes('control plane'),
      'conductor session must still receive control-plane context (stdout: ' + res.stdout + ')',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
