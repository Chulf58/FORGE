#!/usr/bin/env node
// @covers mcp/lib/orchestrator/implement-stage.mjs
// TDD red-bar: implement-stage orchestrator agent team honoring
//
// New feature AC: runImplementStageOrchestrator honors run.stages.implement.agents
// configuration instead of dispatching a hardcoded sequence.
//
// Behavior rules:
// - CONFIGURABLE agents (gated on list membership): coder-scout, completeness-checker, implementation-architect
// - PROTECTED FLOOR (always dispatched): coder, test-author
// - Empty/null/absent list → fall back to core default ["coder-scout","coder","completeness-checker"]
// - Unknown agent names are dropped (not dispatched)
// - Dispatch ORDER stays fixed: implementation-architect (if listed) FIRST, then coder-scout, test-author, coder, completeness-checker
//
// Test strategy
// ─────────────
// Inject mock dependencies + mock readRunJson that returns run.stages.implement.agents
// with various team configurations. Capture the ordered list of dispatched agents.
// Each test verifies the orchestrator's filtering + reordering logic against the configured team.

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
  const dispatchedDetail = [];

  const dispatch = async (agentType, promptLines, opts = {}) => {
    dispatchedAgents.push(agentType);
    dispatchedDetail.push({ agentType, promptLines });
    return { exitCode: 0, outcome: 'completed', stdout: '{}', stderr: '' };
  };

  return {
    dispatch,
    getDispatchedAgents: () => dispatchedAgents,
    // promptLines array passed to the FIRST dispatch of agentType, or null.
    getPromptFor: (agentType) => {
      const entry = dispatchedDetail.find((d) => d.agentType === agentType);
      return entry ? entry.promptLines : null;
    },
    // promptLines arrays for ALL dispatches of agentType (e.g. main + revise coder).
    getPromptsFor: (agentType) => dispatchedDetail
      .filter((d) => d.agentType === agentType)
      .map((d) => d.promptLines),
  };
}

/**
 * Create mock file operations for team-honoring tests.
 * readRunJson returns a run with configurable stages.implement.agents.
 */
function createMockFileOpsWithTeam(configuredTeam) {
  return {
    readRunJson: async (runPath) => ({
      runId: 'r-team-test',
      feature: 'Test feature',
      status: 'running',
      stages: {
        implement: {
          agents: configuredTeam, // Control the team via test parameter
        },
      },
      orchestratorState: { implementReviseCount: 0 },
    }),

    writeRunJson: async (runPath, data) => {
      // No-op
    },

    readPlanMd: async () => '',

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
  };
}

// ── AC-Team-1: Team omits coder-scout ────────────────────────────────────────

test('AC-Team-1: team omits coder-scout → coder-scout NOT dispatched', async () => {
  const tracker = createDispatchTracker();
  const configuredTeam = ['coder', 'completeness-checker'];
  const fileOps = createMockFileOpsWithTeam(configuredTeam);

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  try {
    await runImplementStageOrchestrator(deps, 'r-team-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const dispatched = tracker.getDispatchedAgents();
  assert.ok(
    !dispatched.includes('coder-scout'),
    'AC-Team-1: coder-scout must NOT be dispatched when omitted from configured team'
  );
});

// ── AC-Team-2: Team includes implementation-architect ───────────────────────

test('AC-Team-2: team includes implementation-architect → dispatched first', async () => {
  const tracker = createDispatchTracker();
  const configuredTeam = ['coder-scout', 'coder', 'completeness-checker', 'implementation-architect'];
  const fileOps = createMockFileOpsWithTeam(configuredTeam);

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  try {
    await runImplementStageOrchestrator(deps, 'r-team-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const dispatched = tracker.getDispatchedAgents();
  assert.ok(
    dispatched.includes('implementation-architect'),
    'AC-Team-2: implementation-architect must be dispatched when in configured team'
  );

  const archIdx = dispatched.indexOf('implementation-architect');
  const scoutIdx = dispatched.indexOf('coder-scout');
  assert.ok(
    archIdx < scoutIdx,
    'AC-Team-2: implementation-architect must be dispatched BEFORE coder-scout (order: first)'
  );
});

// ── AC-Team-3: Team omits completeness-checker ──────────────────────────────

test('AC-Team-3: team omits completeness-checker → NOT dispatched', async () => {
  const tracker = createDispatchTracker();
  const configuredTeam = ['coder-scout', 'coder'];
  const fileOps = createMockFileOpsWithTeam(configuredTeam);

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  try {
    await runImplementStageOrchestrator(deps, 'r-team-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const dispatched = tracker.getDispatchedAgents();
  assert.ok(
    !dispatched.includes('completeness-checker'),
    'AC-Team-3: completeness-checker must NOT be dispatched when omitted from configured team'
  );
});

// ── AC-Team-4: FLOOR — team omits coder/test-author, but they are still dispatched ──

test('AC-Team-4: FLOOR — test-author ALWAYS dispatched even if omitted from team', async () => {
  const tracker = createDispatchTracker();
  const configuredTeam = ['coder-scout'];
  const fileOps = createMockFileOpsWithTeam(configuredTeam);

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  try {
    await runImplementStageOrchestrator(deps, 'r-team-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const dispatched = tracker.getDispatchedAgents();
  assert.ok(
    dispatched.includes('test-author'),
    'AC-Team-4: test-author must ALWAYS be dispatched (protected floor) even if omitted from team'
  );
});

test('AC-Team-4b: FLOOR — coder ALWAYS dispatched even if omitted from team', async () => {
  const tracker = createDispatchTracker();
  const configuredTeam = ['coder-scout'];
  const fileOps = createMockFileOpsWithTeam(configuredTeam);

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  try {
    await runImplementStageOrchestrator(deps, 'r-team-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const dispatched = tracker.getDispatchedAgents();
  assert.ok(
    dispatched.includes('coder'),
    'AC-Team-4b: coder must ALWAYS be dispatched (protected floor) even if omitted from team'
  );
});

// ── AC-Team-5: Empty/absent team → core default dispatched ──────────────────

test('AC-Team-5: empty team → core default agents dispatched', async () => {
  const tracker = createDispatchTracker();
  const configuredTeam = [];
  const fileOps = createMockFileOpsWithTeam(configuredTeam);

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  try {
    await runImplementStageOrchestrator(deps, 'r-team-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const dispatched = tracker.getDispatchedAgents();
  // Core default: coder-scout, coder, completeness-checker (+ test-author floor)
  assert.ok(
    dispatched.includes('coder-scout'),
    'AC-Team-5: empty team must fall back to core default (coder-scout)'
  );
  assert.ok(
    dispatched.includes('coder'),
    'AC-Team-5: empty team must fall back to core default (coder)'
  );
  assert.ok(
    dispatched.includes('completeness-checker'),
    'AC-Team-5: empty team must fall back to core default (completeness-checker)'
  );
});

test('AC-Team-5b: absent stages → core default agents dispatched', async () => {
  const tracker = createDispatchTracker();
  const fileOps = createMockFileOpsWithTeam(undefined);
  // Override readRunJson to return a run WITHOUT stages
  fileOps.readRunJson = async (runPath) => ({
    runId: 'r-team-test',
    feature: 'Test feature',
    status: 'running',
    // NO stages field
    orchestratorState: { implementReviseCount: 0 },
  });

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  try {
    await runImplementStageOrchestrator(deps, 'r-team-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const dispatched = tracker.getDispatchedAgents();
  assert.ok(
    dispatched.includes('coder-scout'),
    'AC-Team-5b: absent stages must fall back to core default (coder-scout)'
  );
  assert.ok(
    dispatched.includes('coder'),
    'AC-Team-5b: absent stages must fall back to core default (coder)'
  );
  assert.ok(
    dispatched.includes('completeness-checker'),
    'AC-Team-5b: absent stages must fall back to core default (completeness-checker)'
  );
});

// ── AC-Team-6: Unknown agent names are dropped ──────────────────────────────

test('AC-Team-6: unknown agent names are dropped (not dispatched)', async () => {
  const tracker = createDispatchTracker();
  const configuredTeam = ['coder-scout', 'bogus-agent', 'coder', 'unknown-thing'];
  const fileOps = createMockFileOpsWithTeam(configuredTeam);

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  try {
    await runImplementStageOrchestrator(deps, 'r-team-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const dispatched = tracker.getDispatchedAgents();
  assert.ok(
    !dispatched.includes('bogus-agent'),
    'AC-Team-6: unknown agent "bogus-agent" must NOT be dispatched'
  );
  assert.ok(
    !dispatched.includes('unknown-thing'),
    'AC-Team-6: unknown agent "unknown-thing" must NOT be dispatched'
  );
  // But known agents should be there
  assert.ok(
    dispatched.includes('coder-scout'),
    'AC-Team-6: known agent coder-scout must still be dispatched'
  );
  assert.ok(
    dispatched.includes('coder'),
    'AC-Team-6: known agent coder must still be dispatched'
  );
});

// ── AC-Team-7: Order is preserved (implementation-architect first, then fixed order) ──

test('AC-Team-7: dispatch order respects the fixed ordering rule', async () => {
  const tracker = createDispatchTracker();
  // List them out of order to test the orchestrator reorders correctly
  const configuredTeam = ['completeness-checker', 'implementation-architect', 'coder-scout'];
  const fileOps = createMockFileOpsWithTeam(configuredTeam);

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  try {
    await runImplementStageOrchestrator(deps, 'r-team-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const dispatched = tracker.getDispatchedAgents();

  // Expected order: implementation-architect (if present) FIRST, then:
  // coder-scout, test-author, coder, completeness-checker
  const implArchIdx = dispatched.indexOf('implementation-architect');
  const scoutIdx = dispatched.indexOf('coder-scout');
  const testAuthorIdx = dispatched.indexOf('test-author');
  const coderIdx = dispatched.indexOf('coder');
  const completeIdx = dispatched.indexOf('completeness-checker');

  assert.ok(implArchIdx >= 0, 'AC-Team-7: implementation-architect must be dispatched');
  assert.ok(scoutIdx >= 0, 'AC-Team-7: coder-scout must be dispatched');
  assert.ok(testAuthorIdx >= 0, 'AC-Team-7: test-author must be dispatched');
  assert.ok(coderIdx >= 0, 'AC-Team-7: coder must be dispatched');
  assert.ok(completeIdx >= 0, 'AC-Team-7: completeness-checker must be dispatched');

  // Verify order
  assert.ok(
    implArchIdx < scoutIdx,
    'AC-Team-7: implementation-architect must be dispatched before coder-scout'
  );
  assert.ok(
    scoutIdx < testAuthorIdx,
    'AC-Team-7: coder-scout must be dispatched before test-author'
  );
  assert.ok(
    testAuthorIdx < coderIdx,
    'AC-Team-7: test-author must be dispatched before coder'
  );
  assert.ok(
    coderIdx < completeIdx,
    'AC-Team-7: coder must be dispatched before completeness-checker'
  );
});

// ── AC-Team-8: Mixed test — some configurable, floor always present ─────────

test('AC-Team-8: mixed team — implementation-architect omitted, both floor agents present', async () => {
  const tracker = createDispatchTracker();
  const configuredTeam = ['coder-scout', 'completeness-checker'];
  const fileOps = createMockFileOpsWithTeam(configuredTeam);

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  try {
    await runImplementStageOrchestrator(deps, 'r-team-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const dispatched = tracker.getDispatchedAgents();

  // Should have: coder-scout, test-author, coder, completeness-checker (in that order)
  // Should NOT have: implementation-architect
  const scoutIdx = dispatched.indexOf('coder-scout');
  const testAuthorIdx = dispatched.indexOf('test-author');
  const coderIdx = dispatched.indexOf('coder');
  const completeIdx = dispatched.indexOf('completeness-checker');
  const implArchIdx = dispatched.indexOf('implementation-architect');

  assert.ok(scoutIdx >= 0, 'AC-Team-8: coder-scout dispatched');
  assert.ok(testAuthorIdx >= 0, 'AC-Team-8: test-author dispatched (floor)');
  assert.ok(coderIdx >= 0, 'AC-Team-8: coder dispatched (floor)');
  assert.ok(completeIdx >= 0, 'AC-Team-8: completeness-checker dispatched');
  assert.equal(implArchIdx, -1, 'AC-Team-8: implementation-architect NOT dispatched (omitted from team)');

  // Order check
  assert.ok(scoutIdx < testAuthorIdx, 'AC-Team-8: coder-scout before test-author');
  assert.ok(testAuthorIdx < coderIdx, 'AC-Team-8: test-author before coder');
  assert.ok(coderIdx < completeIdx, 'AC-Team-8: coder before completeness-checker');
});

// ── AC-Team-9: scout omitted → coder prompt has NO dangling [scout-output:] ──
// When coder-scout is not in the team it is not dispatched, so scout.json is never
// written. The coder prompt must NOT carry a [scout-output:] reference to a file that
// does not exist (that token would otherwise satisfy the coder's scout-precondition and
// produce a degraded, map-less coder).

test('AC-Team-9: team omits coder-scout → coder prompt does NOT inject [scout-output:]', async () => {
  const tracker = createDispatchTracker();
  const configuredTeam = ['coder', 'completeness-checker']; // no coder-scout
  const fileOps = createMockFileOpsWithTeam(configuredTeam);

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  try {
    await runImplementStageOrchestrator(deps, 'r-team-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const coderPrompt = tracker.getPromptFor('coder');
  assert.ok(coderPrompt, 'AC-Team-9: coder must still be dispatched (floor)');
  assert.ok(
    !coderPrompt.join('\n').includes('[scout-output:'),
    'AC-Team-9: coder prompt must NOT carry a dangling [scout-output: reference when coder-scout was not dispatched'
  );
});

// ── AC-Team-10: scout present → coder prompt KEEPS [scout-output:] (regression guard) ──

test('AC-Team-10: team includes coder-scout → coder prompt DOES include [scout-output:]', async () => {
  const tracker = createDispatchTracker();
  const configuredTeam = ['coder-scout', 'coder', 'completeness-checker'];
  const fileOps = createMockFileOpsWithTeam(configuredTeam);

  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
  };

  try {
    await runImplementStageOrchestrator(deps, 'r-team-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const coderPrompt = tracker.getPromptFor('coder');
  assert.ok(coderPrompt, 'AC-Team-10: coder must be dispatched');
  assert.ok(
    coderPrompt.join('\n').includes('[scout-output: docs/context/scout.json]'),
    'AC-Team-10: coder prompt must include [scout-output:] when coder-scout ran'
  );
});

// ── AC-Team-11: revise re-dispatch ALSO drops [scout-output:] when scout omitted ──
// The coder is re-dispatched on a REVISE verdict; that re-dispatch must apply the same
// scout-output gating, or the dangling reference returns on the revision pass.

test('AC-Team-11: revise coder re-dispatch also drops [scout-output:] when coder-scout omitted', async () => {
  const tracker = createDispatchTracker();
  const configuredTeam = ['coder', 'completeness-checker']; // no coder-scout
  const fileOps = createMockFileOpsWithTeam(configuredTeam);

  let reviewerReads = 0;
  const deps = {
    ...fileOps,
    dispatch: tracker.dispatch,
    // One reviewer that returns REVISE on the first round, APPROVED on the second
    // (ends the revise loop after exactly one coder re-dispatch).
    spawnScript: async (script) => {
      if (script.includes('reviewer-dispatch')) {
        return { exitCode: 0, stdout: JSON.stringify({ reviewers: ['reviewer-boundary'], reasons: [] }), stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    readReviewerOutput: async () => {
      reviewerReads += 1;
      return { verdict: reviewerReads <= 1 ? 'REVISE' : 'APPROVED' };
    },
  };

  try {
    await runImplementStageOrchestrator(deps, 'r-team-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const coderPrompts = tracker.getPromptsFor('coder');
  assert.ok(
    coderPrompts.length >= 2,
    'AC-Team-11: expected a revise re-dispatch (>=2 coder dispatches), got ' + coderPrompts.length
  );
  for (const p of coderPrompts) {
    assert.ok(
      !p.join('\n').includes('[scout-output:'),
      'AC-Team-11: every coder dispatch (incl. revise) must omit [scout-output:] when coder-scout was not dispatched'
    );
  }
});
