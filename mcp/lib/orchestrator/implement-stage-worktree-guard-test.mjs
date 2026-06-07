#!/usr/bin/env node
// @covers mcp/lib/orchestrator/implement-stage.mjs
// TDD red-bar: implement-stage orchestrator fail-closed on missing worktree
//
// New behavior (worktree-intent integration): when workDir is NOT a worktree
// (per isWorktreePath check), the orchestrator must:
// 1. REFUSE to dispatch any writer agent (test-author, coder)
// 2. Mark the run failed with status='failed' and a failureReason mentioning the missing worktree
// 3. Return without proceeding

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Import the module ──────────────────────────────────────────────────────
let runImplementStageOrchestrator;
try {
  const mod = await import('./implement-stage.mjs');
  runImplementStageOrchestrator = mod.runImplementStageOrchestrator;
} catch (err) {
  test('T0 — implement-stage.mjs must be importable', () => {
    assert.fail('Failed to import: ' + err.message);
  });
  process.exit(1); // eslint-disable-line n/no-process-exit
}

// ── Helper functions ────────────────────────────────────────────────────────

/**
 * Create a mock dispatch that tracks the sequence of agent dispatches.
 * Returns the list of dispatched agentTypes in order.
 */
function createDispatchTracker() {
  const dispatchedAgents = [];

  const dispatch = async (agentType, promptLines, opts = {}) => {
    dispatchedAgents.push(agentType);
    return { exitCode: 0, outcome: 'completed', stdout: '{}', stderr: '' };
  };

  return {
    dispatch,
    getDispatchedAgents: () => dispatchedAgents,
  };
}

/**
 * Create mock file operations for worktree-guard tests.
 * Captures writeRunJson payloads so we can assert the run was marked failed.
 */
function createMockFileOpsWithWorktreeGuard() {
  const writeRunJsonPayloads = [];

  return {
    readRunJson: async (runPath) => ({
      runId: 'r-guard-test',
      feature: 'Test feature',
      status: 'running',
      stages: {
        implement: {
          agents: ['coder-scout', 'coder', 'completeness-checker'],
        },
      },
      orchestratorState: { implementReviseCount: 0 },
    }),

    writeRunJson: async (runPath, data) => {
      writeRunJsonPayloads.push(data);
    },

    readPlanMd: async () => '## Active Plan\n### Feature: Test feature\n- [ ] 1. create `scripts/thing-test.mjs` (red) then `scripts/thing.mjs`',

    writeGateFile: async (gatePath, gateData) => {
      // No-op
    },

    clearReviewerOutput: async (outputDir) => {
      // No-op
    },

    readReviewerOutput: async (outputDir, reviewerName) => ({
      verdict: 'APPROVED',
    }),

    spawnScript: async (script, args) => {
      // Return valid reviewer-dispatch output
      if (script.includes('reviewer-dispatch')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ reviewers: [], reasons: [] }),
          stderr: '',
        };
      }
      // covers-verify
      return { exitCode: 0, stdout: '', stderr: '' };
    },

    commitWorktree: async () => ({
      committed: true,
      sha: 'abc123',
    }),

    writeChangeSummary: async () => {
      // No-op
    },

    changedTestFiles: async () => ['*-test.mjs'],

    // Expose captured payloads for assertions
    getWriteRunJsonPayloads: () => writeRunJsonPayloads,
  };
}

// ── AC-Guard-1: Non-worktree workDir blocks writers ──────────────────────────

test('AC-Guard-1: NON-worktree workDir → test-author NOT dispatched', async () => {
  const tracker = createDispatchTracker();
  const fileOps = createMockFileOpsWithWorktreeGuard();

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  // MAIN project root (not a worktree path) — no .worktrees/<runId> segment
  const mainProjectRoot = '/some/main/project/root';

  try {
    await runImplementStageOrchestrator(deps, 'r-guard-test', mainProjectRoot);
  } catch (e) {
    // Ignore errors; we're checking dispatch order
  }

  const dispatched = tracker.getDispatchedAgents();
  assert.ok(
    !dispatched.includes('test-author'),
    'AC-Guard-1: test-author must NOT be dispatched when workDir is not a worktree'
  );
});

test('AC-Guard-1b: NON-worktree workDir → coder NOT dispatched', async () => {
  const tracker = createDispatchTracker();
  const fileOps = createMockFileOpsWithWorktreeGuard();

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  const mainProjectRoot = '/some/main/project/root';

  try {
    await runImplementStageOrchestrator(deps, 'r-guard-test', mainProjectRoot);
  } catch (e) {
    // Ignore errors
  }

  const dispatched = tracker.getDispatchedAgents();
  assert.ok(
    !dispatched.includes('coder'),
    'AC-Guard-1b: coder must NOT be dispatched when workDir is not a worktree'
  );
});

// ── AC-Guard-2: Non-worktree workDir marks run failed ──────────────────────

test('AC-Guard-2: NON-worktree workDir → run marked failed with worktree-related failureReason', async () => {
  const tracker = createDispatchTracker();
  const fileOps = createMockFileOpsWithWorktreeGuard();

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  const mainProjectRoot = '/some/main/project/root';

  try {
    await runImplementStageOrchestrator(deps, 'r-guard-test', mainProjectRoot);
  } catch (e) {
    // Ignore errors
  }

  const payloads = fileOps.getWriteRunJsonPayloads();
  const failedPayload = payloads.find((p) => p && p.status === 'failed');

  assert.ok(
    failedPayload,
    'AC-Guard-2: run must be marked status=failed when workDir is not a worktree'
  );

  assert.ok(
    failedPayload.failureReason &&
    (failedPayload.failureReason.toLowerCase().includes('worktree') ||
     failedPayload.failureReason.toLowerCase().includes('missing') ||
     failedPayload.failureReason.toLowerCase().includes('require')),
    'AC-Guard-2: failureReason must mention worktree or missing requirement. Got: ' + (failedPayload.failureReason || 'undefined')
  );
});

// ── AC-Guard-3: Regression guard — worktree workDir allows writers ──────────

test('AC-Guard-3: worktree workDir → coder IS dispatched (regression guard)', async () => {
  const tracker = createDispatchTracker();
  const fileOps = createMockFileOpsWithWorktreeGuard();

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  // A proper worktree path containing .worktrees/<runId>
  const worktreePath = '/proj/forge-plugin/.worktrees/r-guard-test';

  try {
    await runImplementStageOrchestrator(deps, 'r-guard-test', worktreePath);
  } catch (e) {
    // Ignore errors; we just want to verify coder is dispatched
  }

  const dispatched = tracker.getDispatchedAgents();
  assert.ok(
    dispatched.includes('coder'),
    'AC-Guard-3: coder must be dispatched when workDir IS a valid worktree path'
  );
});

test('AC-Guard-3b: worktree workDir → test-author IS dispatched (regression guard)', async () => {
  const tracker = createDispatchTracker();
  const fileOps = createMockFileOpsWithWorktreeGuard();

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  const worktreePath = '/proj/forge-plugin/.worktrees/r-guard-test';

  try {
    await runImplementStageOrchestrator(deps, 'r-guard-test', worktreePath);
  } catch (e) {
    // Ignore errors
  }

  const dispatched = tracker.getDispatchedAgents();
  assert.ok(
    dispatched.includes('test-author'),
    'AC-Guard-3b: test-author must be dispatched when workDir IS a valid worktree path'
  );
});

// ── AC-Guard-4: Early return when non-worktree detected ────────────────────

test('AC-Guard-4: non-worktree → function returns without error', async () => {
  const tracker = createDispatchTracker();
  const fileOps = createMockFileOpsWithWorktreeGuard();

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  const mainProjectRoot = '/some/main/project/root';

  let caughtError = null;
  try {
    await runImplementStageOrchestrator(deps, 'r-guard-test', mainProjectRoot);
  } catch (e) {
    caughtError = e;
  }

  // Should NOT throw; should return cleanly after marking failed
  assert.strictEqual(
    caughtError,
    null,
    'AC-Guard-4: orchestrator should not throw when workDir is not a worktree; it should return cleanly after marking failed'
  );
});

// ── AC-Guard-5: Windows-style worktree paths are recognized ──────────────────

test('AC-Guard-5: Windows-style worktree path → coder dispatched', async () => {
  const tracker = createDispatchTracker();
  const fileOps = createMockFileOpsWithWorktreeGuard();

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  // Windows-style path
  const worktreePath = 'C:\\Users\\cuj\\forge-plugin\\.worktrees\\r-guard-test';

  try {
    await runImplementStageOrchestrator(deps, 'r-guard-test', worktreePath);
  } catch (e) {
    // Ignore
  }

  const dispatched = tracker.getDispatchedAgents();
  assert.ok(
    dispatched.includes('coder'),
    'AC-Guard-5: Windows-style .worktrees path must be recognized and allow dispatch'
  );
});
