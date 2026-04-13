#!/usr/bin/env node
'use strict';

// Regression test: hooks/ctx-session-start.js must, when
// .pipeline/run-active.json.currentUnit references a terminal run (status
// "completed" / "failed" / "discarded"):
//   a) emit NO stale-lock notice on stdout (no hookSpecificOutput envelope,
//      no "FORGE notice:" text), and
//   b) rewrite .pipeline/run-active.json with currentUnit === null.
//
// Run: node hooks/ctx-session-start-terminal-cleanup-test.js
//
// Narrow-scope integration test: spawns the real hook as a child process
// (same pattern as hooks/apply-context-inject-test.js), uses a temp project
// fixture, asserts both stdout and on-disk state. No test framework.

const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');

const HOOK = join(__dirname, 'ctx-session-start.js');
const ISO  = '2026-04-13T00:00:00.000Z';

function seedProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-sessionstart-term-test-'));
  mkdirSync(join(projectDir, '.pipeline', 'runs', 'r-term01'), { recursive: true });

  // Terminal prior run — status: "completed".
  writeFileSync(
    join(projectDir, '.pipeline', 'runs', 'r-term01', 'run.json'),
    JSON.stringify({
      runId: 'r-term01',
      sessionId: 'sess-prior',
      projectRoot: projectDir,
      worktreePath: null,
      branchName: null,
      pipelineType: 'implement',
      mode: 'LEAN',
      feature: 'prior feature',
      status: 'completed',
      createdAt: ISO,
      updatedAt: ISO,
      currentStep: 'done',
      gateState: null,
      agents: [],
      artifacts: { plan: null, handoff: null, scout: null },
    }, null, 2)
  );

  // run-active.json references the terminal run and carries a stale marker.
  writeFileSync(
    join(projectDir, '.pipeline', 'run-active.json'),
    JSON.stringify({
      startedAt: Date.now() - 60_000,
      runId: 'r-term01',
      pipelineType: 'implement',
      mode: 'LEAN',
      feature: 'prior feature',
      agents: [],
      currentUnit: { agent: 'coder', startedAt: Date.now() - 120_000 },
    }, null, 2)
  );

  return projectDir;
}

function runHook(projectDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      cwd: projectDir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: join(__dirname, '..') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', reject);

    // SessionStart payload shape — transcript_path empty avoids context-window
    // branch side effects; cwd drives the project-dir resolution.
    const payload = {
      session_id: 'sess-new',
      transcript_path: '',
      cwd: projectDir,
    };
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function fail(msg) {
  console.error('[ctx-session-start-terminal-cleanup] FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

async function main() {
  const projectDir = seedProject();
  try {
    const { code, stdout, stderr } = await runHook(projectDir);
    if (code !== 0) {
      return fail('hook exited with code ' + code + '; stderr=' + JSON.stringify(stderr));
    }

    // Assertion A: no stale-lock notice emitted.
    const trimmed = stdout.trim();
    if (trimmed.includes('FORGE notice:')) {
      return fail('stdout should not contain "FORGE notice:"; got: ' + JSON.stringify(trimmed));
    }
    if (trimmed.includes('hookSpecificOutput')) {
      return fail('stdout should not contain a hookSpecificOutput envelope; got: ' + JSON.stringify(trimmed));
    }

    // Assertion B: run-active.json.currentUnit is rewritten to null on disk.
    const raw = readFileSync(join(projectDir, '.pipeline', 'run-active.json'), 'utf8');
    const ra = JSON.parse(raw);
    if (ra.currentUnit !== null) {
      return fail('INVARIANT VIOLATED: run-active.json.currentUnit should be null after terminal-run cleanup, got: ' + JSON.stringify(ra.currentUnit));
    }
    // Preservation sanity: other fields still there.
    if (ra.runId !== 'r-term01') {
      return fail('cleanup must preserve other fields; runId lost, got: ' + JSON.stringify(ra));
    }

    console.log('[ctx-session-start-terminal-cleanup] PASS');
    console.log('  no notice emitted on stdout');
    console.log('  run-active.json.currentUnit === null');
  } finally {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch((err) => {
  console.error('[ctx-session-start-terminal-cleanup] unexpected throw:', err);
  process.exit(1);
});
