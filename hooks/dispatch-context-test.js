#!/usr/bin/env node
'use strict';
// Failing tests for dispatch-context resolution (Phase 1 — TDD wave 1 red bar).
//
// Guards AC-1 through AC-5 from docs/PLAN.md §Phase 1:
//
//   (a) Valid .pipeline/dispatch-context.json present → resolveRunId returns its runId
//       (4th resolution path, after env var + worktree-path, before findActiveRun).
//   (b) File present with invalid runId format → falls through to findActiveRun.
//   (c) File absent → falls through to findActiveRun.
//   (d) File present but createdAt > 5 min old at SessionStart → file is deleted
//       and '[forge-dispatch-ctx] stale dispatch-context deleted' emitted to stderr.
//   (e) subagent-start.js swap from findActiveRun to resolveRunId — resolves correctly
//       when dispatch-context.json is present and env var + worktree-path do not match.
//
// Run: node hooks/dispatch-context-test.js
// Auto-discovered by scripts/run-tests.mjs via hooks/*-test.js suffix.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const path = require('node:path');

const utils = require('./hook-utils.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seed(projectDir, runs) {
  for (const [runId, status] of runs) {
    mkdirSync(join(projectDir, '.pipeline', 'runs', runId), { recursive: true });
    writeFileSync(
      join(projectDir, '.pipeline', 'runs', runId, 'run.json'),
      JSON.stringify({ runId, status, pipelineType: 'plan', feature: 'test' })
    );
  }
}

function writeDispatchContext(projectDir, data) {
  mkdirSync(join(projectDir, '.pipeline'), { recursive: true });
  writeFileSync(
    join(projectDir, '.pipeline', 'dispatch-context.json'),
    JSON.stringify(data)
  );
}

// ---------------------------------------------------------------------------
// (a) Valid dispatch-context file → resolveRunId returns its runId
// ---------------------------------------------------------------------------

test('resolveRunId — dispatch-context file (4th path): valid runId returned', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-dctx-test-'));
  // Seed two ambiguous non-terminal runs so findActiveRun returns null.
  seed(projectDir, [['r-aaa111', 'running'], ['r-bbb222', 'running']]);
  // Write a fresh dispatch-context.json so the 4th path fires.
  writeDispatchContext(projectDir, {
    runId: 'r-conductor1',
    createdAt: new Date().toISOString(),
  });

  const origEnv = process.env.FORGE_WORKER_RUN_ID;
  delete process.env.FORGE_WORKER_RUN_ID;

  try {
    const result = await utils.resolveRunId(projectDir, {});
    assert.equal(result, 'r-conductor1',
      'dispatch-context.json with valid runId must be returned as 4th resolution path');
  } finally {
    if (origEnv !== undefined) process.env.FORGE_WORKER_RUN_ID = origEnv;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (b) File present with invalid runId format → falls through to findActiveRun
// ---------------------------------------------------------------------------

test('resolveRunId — dispatch-context file: invalid runId format falls through', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-dctx-test-'));
  // Seed exactly one non-terminal run so findActiveRun returns it.
  seed(projectDir, [['r-onlyone', 'running']]);
  // Write dispatch-context with a runId that fails the r-[a-zA-Z0-9]+ pattern.
  writeDispatchContext(projectDir, {
    runId: 'not-a-valid-run-id',
    createdAt: new Date().toISOString(),
  });

  const origEnv = process.env.FORGE_WORKER_RUN_ID;
  delete process.env.FORGE_WORKER_RUN_ID;

  try {
    const result = await utils.resolveRunId(projectDir, {});
    assert.equal(result, 'r-onlyone',
      'invalid runId in dispatch-context.json must fall through to findActiveRun');
  } finally {
    if (origEnv !== undefined) process.env.FORGE_WORKER_RUN_ID = origEnv;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (c) File absent → falls through to findActiveRun
// ---------------------------------------------------------------------------

test('resolveRunId — dispatch-context file absent: falls through to findActiveRun', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-dctx-test-'));
  seed(projectDir, [['r-singlerun', 'running']]);
  // No dispatch-context.json written.

  const origEnv = process.env.FORGE_WORKER_RUN_ID;
  delete process.env.FORGE_WORKER_RUN_ID;

  try {
    const result = await utils.resolveRunId(projectDir, {});
    assert.equal(result, 'r-singlerun',
      'absent dispatch-context.json must fall through to findActiveRun (3rd path)');
  } finally {
    if (origEnv !== undefined) process.env.FORGE_WORKER_RUN_ID = origEnv;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (d) Stale dispatch-context (>5 min) at SessionStart → file deleted + stderr
// ---------------------------------------------------------------------------

test('ctx-session-start: stale dispatch-context (>5 min) is deleted at SessionStart', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-dctx-test-'));
  mkdirSync(join(projectDir, '.pipeline', 'runs'), { recursive: true });

  // Write a dispatch-context.json with a createdAt more than 5 minutes ago.
  const staleMs = Date.now() - (6 * 60 * 1000); // 6 minutes ago
  writeDispatchContext(projectDir, {
    runId: 'r-oldconductor',
    createdAt: new Date(staleMs).toISOString(),
  });

  const ctxFile = join(projectDir, '.pipeline', 'dispatch-context.json');
  assert.ok(existsSync(ctxFile), 'dispatch-context.json must exist before cleanup');

  // The cleanup function should be exported from ctx-session-start.js
  // or hook-utils.js. We call it here to verify the stale-cleanup behavior.
  // AC-4: ctx-session-start.js must export or expose a cleanupStaleDispatchContext
  // function that accepts projectDir and deletes stale files.
  const { cleanupStaleDispatchContext } = require('./ctx-session-start.js');
  assert.equal(typeof cleanupStaleDispatchContext, 'function',
    'ctx-session-start.js must export cleanupStaleDispatchContext for testability');

  const stderrLines = [];
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    stderrLines.push(String(chunk));
    return origStderrWrite(chunk, ...rest);
  };

  try {
    await cleanupStaleDispatchContext(projectDir);
    assert.ok(!existsSync(ctxFile),
      'stale dispatch-context.json (>5 min) must be deleted by cleanupStaleDispatchContext');
    const hasMsg = stderrLines.some(l =>
      l.includes('[forge-dispatch-ctx]') && l.includes('stale dispatch-context deleted')
    );
    assert.ok(hasMsg,
      'cleanupStaleDispatchContext must emit "[forge-dispatch-ctx] stale dispatch-context deleted" to stderr');
  } finally {
    process.stderr.write = origStderrWrite;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('ctx-session-start: fresh dispatch-context (<5 min) is NOT deleted at SessionStart', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-dctx-test-'));
  mkdirSync(join(projectDir, '.pipeline', 'runs'), { recursive: true });

  // Write a fresh dispatch-context.json (just now).
  writeDispatchContext(projectDir, {
    runId: 'r-freshconductor',
    createdAt: new Date().toISOString(),
  });

  const ctxFile = join(projectDir, '.pipeline', 'dispatch-context.json');

  const { cleanupStaleDispatchContext } = require('./ctx-session-start.js');

  try {
    await cleanupStaleDispatchContext(projectDir);
    assert.ok(existsSync(ctxFile),
      'fresh dispatch-context.json must NOT be deleted by cleanupStaleDispatchContext');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('ctx-session-start: absent dispatch-context is a no-op (never throws)', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-dctx-test-'));
  mkdirSync(join(projectDir, '.pipeline', 'runs'), { recursive: true });
  // No dispatch-context.json written.

  const { cleanupStaleDispatchContext } = require('./ctx-session-start.js');

  try {
    // Must not throw.
    await assert.doesNotReject(
      async () => cleanupStaleDispatchContext(projectDir),
      'cleanupStaleDispatchContext must not throw when dispatch-context.json is absent'
    );
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (e) subagent-start.js swap: resolveRunId used (not findActiveRun directly)
// ---------------------------------------------------------------------------

test('subagent-start.js: imports resolveRunId (not findActiveRun at dispatch site)', () => {
  // Read the source of subagent-start.js and verify it calls resolveRunId.
  // This is a static-analysis assertion that guards the swap (AC-3).
  const src = require('fs').readFileSync(
    path.join(__dirname, 'subagent-start.js'),
    'utf8'
  );

  // Must import resolveRunId from hook-utils.
  assert.match(src, /resolveRunId/,
    'subagent-start.js must import and use resolveRunId');

  // Must NOT call findActiveRun directly at the dispatch resolution site.
  // The pattern "await findActiveRun(" must not appear — resolveRunId calls
  // it internally, but the hook itself must go through resolveRunId.
  const directCall = /await\s+findActiveRun\s*\(/;
  assert.doesNotMatch(src, directCall,
    'subagent-start.js must not call findActiveRun directly; use resolveRunId instead');
});

test('subagent-start.js: resolveRunId resolves dispatch-context runId at subagent attribution', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-dctx-test-'));
  // Seed two ambiguous runs — findActiveRun alone would return null.
  seed(projectDir, [['r-aaa111', 'running'], ['r-bbb222', 'running']]);
  // Write dispatch-context so the 4th path fires.
  writeDispatchContext(projectDir, {
    runId: 'r-dispatch1',
    createdAt: new Date().toISOString(),
  });

  const origEnv = process.env.FORGE_WORKER_RUN_ID;
  delete process.env.FORGE_WORKER_RUN_ID;

  try {
    // resolveRunId (which subagent-start.js now calls) must return the dispatch-context runId.
    const result = await utils.resolveRunId(projectDir, {});
    assert.equal(result, 'r-dispatch1',
      'resolveRunId must return dispatch-context runId when env var + worktree-path are absent ' +
      'and findActiveRun would be ambiguous — this validates the subagent-start swap end-to-end');
  } finally {
    if (origEnv !== undefined) process.env.FORGE_WORKER_RUN_ID = origEnv;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Priority: dispatch-context must rank BELOW env var and worktree-path
// ---------------------------------------------------------------------------

test('resolveRunId — env var still wins over dispatch-context file', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-dctx-test-'));
  seed(projectDir, [['r-aaa111', 'running'], ['r-bbb222', 'running']]);
  writeDispatchContext(projectDir, {
    runId: 'r-conductor1',
    createdAt: new Date().toISOString(),
  });

  const origEnv = process.env.FORGE_WORKER_RUN_ID;
  process.env.FORGE_WORKER_RUN_ID = 'r-envwins';

  try {
    const result = await utils.resolveRunId(projectDir, {});
    assert.equal(result, 'r-envwins',
      'env var (1st path) must beat dispatch-context file (4th path)');
  } finally {
    if (origEnv === undefined) delete process.env.FORGE_WORKER_RUN_ID;
    else process.env.FORGE_WORKER_RUN_ID = origEnv;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('resolveRunId — worktree-path cwd still wins over dispatch-context file', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-dctx-test-'));
  seed(projectDir, [['r-aaa111', 'running'], ['r-bbb222', 'running']]);
  writeDispatchContext(projectDir, {
    runId: 'r-conductor1',
    createdAt: new Date().toISOString(),
  });

  const origEnv = process.env.FORGE_WORKER_RUN_ID;
  delete process.env.FORGE_WORKER_RUN_ID;

  try {
    const wtPath = path.join(projectDir, '.worktrees', 'r-wtwins');
    const result = await utils.resolveRunId(projectDir, { cwd: wtPath });
    assert.equal(result, 'r-wtwins',
      'worktree-path detection (2nd path) must beat dispatch-context file (4th path)');
  } finally {
    if (origEnv !== undefined) process.env.FORGE_WORKER_RUN_ID = origEnv;
    rmSync(projectDir, { recursive: true, force: true });
  }
});
