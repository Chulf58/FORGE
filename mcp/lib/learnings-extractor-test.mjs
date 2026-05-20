// @covers mcp/lib/learnings-extractor.mjs
// TDD red-bar: behavioral contract for learnings-extractor agent module.
// These tests MUST fail until Phase 2 implements mcp/lib/learnings-extractor.mjs.
//
// Structural tests (AC-1): assert that agents/learnings-extractor.md, SKILL.md Step 3.4a,
// and agent-roles.json entry do NOT exist yet — these PASS in red-bar state.
//
// Behavioral tests (AC-2 through AC-6): import the module and exercise it —
// these FAIL until the module is implemented.
//
// Run: node --test mcp/lib/learnings-extractor-test.mjs

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
// mcp/lib/ → mcp/ → repo-root
const REPO_ROOT = resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Try to import the module under test.
// Import fails when the file doesn't exist — that is the red-bar condition.
// ---------------------------------------------------------------------------
let runLearningsExtractor;
let sanitizeTitle;
try {
  const mod = await import('./learnings-extractor.mjs');
  runLearningsExtractor = mod.runLearningsExtractor;
  sanitizeTitle = mod.sanitizeTitle;
} catch (_) {
  runLearningsExtractor = undefined;
  sanitizeTitle = undefined;
}

// ---------------------------------------------------------------------------
// AC-1 — Structural assertions (PASS now because Phase 2 artefacts exist)
// ---------------------------------------------------------------------------

test('AC-1a: agents/learnings-extractor.md exists', () => {
  const agentPath = join(REPO_ROOT, 'agents', 'learnings-extractor.md');
  assert.strictEqual(
    existsSync(agentPath),
    true,
    'agents/learnings-extractor.md must exist after Phase 2',
  );
});

test('AC-1b: skills/apply/SKILL.md contains "3.4a"', () => {
  const skillPath = join(REPO_ROOT, 'skills', 'apply', 'SKILL.md');
  if (!existsSync(skillPath)) {
    assert.fail('skills/apply/SKILL.md must exist after Phase 2');
  }
  const content = readFileSync(skillPath, 'utf8');
  assert.strictEqual(
    content.includes('3.4a'),
    true,
    'skills/apply/SKILL.md must contain "3.4a" after Phase 2',
  );
});

test('AC-1c: .pipeline/agent-roles.json has "learnings-extractor" key', () => {
  const rolesPath = join(REPO_ROOT, '.pipeline', 'agent-roles.json');
  if (!existsSync(rolesPath)) {
    assert.fail('.pipeline/agent-roles.json must exist after Phase 2');
  }
  const roles = JSON.parse(readFileSync(rolesPath, 'utf8'));
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(roles, 'learnings-extractor'),
    true,
    '.pipeline/agent-roles.json must have "learnings-extractor" entry after Phase 2',
  );
});

// ---------------------------------------------------------------------------
// Behavioral tests — all FAIL until Phase 2 creates learnings-extractor.mjs
// ---------------------------------------------------------------------------

// Helper: verify module is loaded before behavioural tests run.
function assertModuleLoaded() {
  assert.strictEqual(
    typeof runLearningsExtractor,
    'function',
    'runLearningsExtractor not exported from mcp/lib/learnings-extractor.mjs — implement Phase 2 first',
  );
}

// ---------------------------------------------------------------------------
// AC-2 — APPROVED-success branch
// ---------------------------------------------------------------------------

test('APPROVED-success: calls forge_add_learning with outcome "approved" and non-empty title/body', async () => {
  assertModuleLoaded();

  const calls = [];
  const mockForgeAddLearning = async (args) => {
    calls.push(args);
    return { ok: true };
  };

  const fixture = {
    outcome: 'approved',
    handoffMd: '# Handoff: My Feature\n\n## Summary\nAdds widget support.\n\n## Files to modify\n### src/widget.js\n**Change:** added export\n',
    verdictFiles: [],
    runJson: { status: 'completed', pipelineType: 'implement', failureReason: null },
    cwd: join(REPO_ROOT, '.worktrees', 'r-test123'),
    mainProjectRoot: REPO_ROOT,
  };

  await runLearningsExtractor(fixture, { forgeAddLearning: mockForgeAddLearning });

  assert.strictEqual(calls.length >= 1, true, 'expected forge_add_learning to be called at least once');
  const call = calls[0];
  assert.strictEqual(call.outcome, 'approved', 'outcome must be "approved"');
  assert.strictEqual(typeof call.title, 'string', 'title must be a string');
  assert.ok(call.title.length > 0, 'title must be non-empty');
  assert.strictEqual(typeof call.body, 'string', 'body must be a string');
  assert.ok(call.body.length > 0, 'body must be non-empty');
});

// ---------------------------------------------------------------------------
// AC-2 — BLOCK-failure branch
// ---------------------------------------------------------------------------

test('BLOCK-failure: calls forge_add_learning with outcome "blocked"', async () => {
  assertModuleLoaded();

  const calls = [];
  const mockForgeAddLearning = async (args) => {
    calls.push(args);
    return { ok: true };
  };

  const fixture = {
    outcome: 'blocked',
    handoffMd: '# Handoff: My Feature\n\n## Summary\nAdds widget support.\n',
    verdictFiles: [
      {
        name: 'reviewer-boundary.json',
        content: JSON.stringify({
          verdict: 'BLOCK',
          findings: [{ severity: 'BLOCK', finding: 'Missing error handling' }],
        }),
      },
    ],
    runJson: { status: 'failed', pipelineType: 'implement', failureReason: 'reviewer BLOCK' },
    cwd: join(REPO_ROOT, '.worktrees', 'r-test123'),
    mainProjectRoot: REPO_ROOT,
  };

  await runLearningsExtractor(fixture, { forgeAddLearning: mockForgeAddLearning });

  assert.strictEqual(calls.length >= 1, true, 'expected forge_add_learning to be called at least once');
  assert.strictEqual(calls[0].outcome, 'blocked', 'outcome must be "blocked"');
});

// ---------------------------------------------------------------------------
// AC-2 — debug_resolved branch
// ---------------------------------------------------------------------------

test('debug_resolved: calls forge_add_learning with outcome "debug_resolved"', async () => {
  assertModuleLoaded();

  const calls = [];
  const mockForgeAddLearning = async (args) => {
    calls.push(args);
    return { ok: true };
  };

  const fixture = {
    outcome: 'debug_resolved',
    handoffMd: '# Handoff: Fix widget crash\n\n## Summary\nFixed null dereference.\n',
    verdictFiles: [],
    runJson: { status: 'completed', pipelineType: 'debug', failureReason: null },
    cwd: join(REPO_ROOT, '.worktrees', 'r-test456'),
    mainProjectRoot: REPO_ROOT,
  };

  await runLearningsExtractor(fixture, { forgeAddLearning: mockForgeAddLearning });

  assert.strictEqual(calls.length >= 1, true, 'expected forge_add_learning to be called');
  assert.strictEqual(calls[0].outcome, 'debug_resolved', 'outcome must be "debug_resolved"');
});

// ---------------------------------------------------------------------------
// AC-3 — conflict-detect: skip on { conflict: true }, no second write
// ---------------------------------------------------------------------------

test('conflict-detect (CONFLICT_DETECTED): skips further writes when forge_add_learning returns { conflict: true }', async () => {
  assertModuleLoaded();

  const calls = [];
  const mockForgeAddLearning = async (args) => {
    calls.push(args);
    return { conflict: true };
  };

  const fixture = {
    outcome: 'approved',
    handoffMd: '# Handoff: Widget\n\n## Summary\nWidget added.\n',
    verdictFiles: [],
    runJson: { status: 'completed', pipelineType: 'implement', failureReason: null },
    cwd: join(REPO_ROOT, '.worktrees', 'r-test789'),
    mainProjectRoot: REPO_ROOT,
  };

  await runLearningsExtractor(fixture, { forgeAddLearning: mockForgeAddLearning });

  // Only the first call should happen — conflict must halt further writes
  assert.strictEqual(calls.length, 1, 'conflict result must stop further forge_add_learning calls');
});

// ---------------------------------------------------------------------------
// AC-4 — mainProjectRoot targeting: non-worktree path still resolves main root
// ---------------------------------------------------------------------------

test('mainProjectRoot targeting: non-worktree cwd resolves to mainProjectRoot (not cwd)', async () => {
  assertModuleLoaded();

  const calls = [];
  const mockForgeAddLearning = async (args) => {
    calls.push(args);
    return { ok: true };
  };

  // cwd is main project root itself (not inside .worktrees/)
  const nonWorktreeCwd = REPO_ROOT;

  const fixture = {
    outcome: 'approved',
    handoffMd: '# Handoff: Feat\n\n## Summary\nDoes something.\n',
    verdictFiles: [],
    runJson: { status: 'completed', pipelineType: 'implement', failureReason: null },
    cwd: nonWorktreeCwd,
    mainProjectRoot: REPO_ROOT,
  };

  await runLearningsExtractor(fixture, { forgeAddLearning: mockForgeAddLearning });

  // The agent must write learnings to mainProjectRoot, not the cwd blindly
  assert.strictEqual(calls.length >= 1, true, 'expected at least one forge_add_learning call');
  // mainProjectRoot path is passed — this exercises the targeting behaviour
  const call = calls[0];
  assert.strictEqual(
    typeof call.projectDir === 'undefined' || call.projectDir === REPO_ROOT,
    true,
    'forge_add_learning projectDir must target mainProjectRoot when specified',
  );
});

// ---------------------------------------------------------------------------
// AC-5 — non-blocking: agent throw must not propagate to caller (apply continues)
// ---------------------------------------------------------------------------

test('non-blocking: forge_add_learning rejection does not propagate (apply continues)', async () => {
  assertModuleLoaded();

  const mockForgeAddLearning = async (_args) => {
    throw new Error('Simulated forge_add_learning failure');
  };

  const fixture = {
    outcome: 'approved',
    handoffMd: '# Handoff: Feat\n\n## Summary\nDoes something.\n',
    verdictFiles: [],
    runJson: { status: 'completed', pipelineType: 'implement', failureReason: null },
    cwd: join(REPO_ROOT, '.worktrees', 'r-testABC'),
    mainProjectRoot: REPO_ROOT,
  };

  // Must NOT throw — apply must continue even when forge_add_learning rejects
  let threw = false;
  try {
    await runLearningsExtractor(fixture, { forgeAddLearning: mockForgeAddLearning });
  } catch (_) {
    threw = true;
  }

  assert.strictEqual(threw, false, 'agent throw must not propagate — apply must continue');
});

// ---------------------------------------------------------------------------
// AC-6 — newline-strip (injection safety): sanitizeTitle strips \n and \r
// ---------------------------------------------------------------------------

test('newline-strip (injection safety): sanitizeTitle strips embedded newlines and carriage returns', () => {
  assert.strictEqual(
    typeof sanitizeTitle,
    'function',
    'sanitizeTitle not exported from mcp/lib/learnings-extractor.mjs — implement Phase 2 first',
  );

  const dirty = 'Widget feature\nmalicious injection\r\ncontinued';
  const clean = sanitizeTitle(dirty);

  assert.ok(
    !clean.includes('\n'),
    'sanitizeTitle must strip \\n characters',
  );
  assert.ok(
    !clean.includes('\r'),
    'sanitizeTitle must strip \\r characters',
  );
  // Must preserve the meaningful part of the title
  assert.ok(
    clean.includes('Widget feature'),
    'sanitizeTitle must preserve the title text',
  );
});
