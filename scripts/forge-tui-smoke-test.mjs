#!/usr/bin/env node
// Smoke test: forge-tui.mjs must start without crashing, render at least
// once, accept a quit signal, and exit with code 0.
//
// Run: node scripts/forge-tui-smoke-test.mjs
//
// The test spawns the TUI against a seeded temp project, lets it run
// briefly, sends 'q' to exit, and asserts exit code. No visual assertions —
// blessed rendering is hard to assert declaratively. This catches regressions
// from dependency breakage, module load errors, and exit-path bugs.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TUI_PATH = resolve(__dirname, 'forge-tui.mjs');

function seed() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-tui-smoke-'));
  mkdirSync(join(projectDir, '.pipeline'), { recursive: true });
  writeFileSync(
    join(projectDir, '.pipeline', 'board.json'),
    JSON.stringify({ todos: [], planned: [] }, null, 2)
  );
  writeFileSync(
    join(projectDir, '.pipeline', 'project.json'),
    JSON.stringify({ name: 'tui-smoke', techStacks: ['Node.js'], pipelineMode: 'lean' }, null, 2)
  );
  return projectDir;
}

function fail(msg) {
  console.error('[forge-tui-smoke] FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

async function main() {
  const projectDir = seed();
  let proc = null;

  try {
    proc = spawn(process.execPath, [TUI_PATH], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });
    // Drain stdout (blessed writes a lot of escape codes there)
    proc.stdout.on('data', () => {});

    // Give the TUI time to start and render once.
    await new Promise(r => setTimeout(r, 1500));

    // If the process already exited, it crashed on startup.
    if (proc.exitCode !== null) {
      fail('TUI exited before quit signal (code=' + proc.exitCode + '). stderr: ' + stderr);
    }

    // Send 'q' to trigger clean exit.
    proc.stdin.write('q');

    // Wait for exit with a timeout.
    const exitCode = await new Promise((resolveExit, rejectExit) => {
      const timeout = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (_) {}
        rejectExit(new Error('TUI did not exit within 3s after q'));
      }, 3000);
      proc.on('exit', (code) => { clearTimeout(timeout); resolveExit(code); });
    });

    if (exitCode !== 0) {
      fail('TUI exited with non-zero code: ' + exitCode + '. stderr: ' + stderr);
    }

    console.log('[forge-tui-smoke] PASS');
    console.log('  TUI started, rendered, accepted q, exited with code 0');

  } catch (err) {
    if (proc && !proc.killed) {
      try { proc.kill('SIGKILL'); } catch (_) {}
    }
    fail('test harness error: ' + (err && err.stack || String(err)));
  } finally {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch(err => {
  console.error('[forge-tui-smoke] unexpected throw:', err);
  process.exit(1);
});
