// @covers mcp/lib/tools/run-gate.js — checkGatePreconditions
//
// RED BAR (TDD phase 1): If checkGatePreconditions is not yet exported from
// run-gate.js, the static import below throws at module-load time:
//   SyntaxError: ... does not provide an export named 'checkGatePreconditions'
// which causes node --test to exit non-zero before any test body executes.
// This is the required red bar confirming the implementation does not exist yet.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkGatePreconditions, register } from './run-gate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempProject() {
  const root = mkdtempSync(join(tmpdir(), 'forge-precond-'));
  mkdirSync(join(root, '.pipeline', 'context', 'reviewer-output'), { recursive: true });
  mkdirSync(join(root, 'docs', 'context'), { recursive: true });
  return root;
}

const ENV_OFF = {};
const ENV_G1 = { FORGE_GATE_PRECONDITION_GATE1: 'on' };
const ENV_G2 = { FORGE_GATE_PRECONDITION_GATE2: 'on' };
const ENV_CM = { FORGE_GATE_PRECONDITION_COMMIT: 'on' };

// ---------------------------------------------------------------------------
// Export presence check
// ---------------------------------------------------------------------------

describe('checkGatePreconditions — export', () => {
  it('is exported as a function', () => {
    assert.strictEqual(typeof checkGatePreconditions, 'function');
  });
});

// ---------------------------------------------------------------------------
// AC-2: all toggles off → always ok:true
// ---------------------------------------------------------------------------

describe('AC-2: all toggles off', () => {
  it('gate1 with no toggles → ok:true', () => {
    const result = checkGatePreconditions(
      'gate1', 'pending',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: null },
      { env: ENV_OFF },
    );
    assert.deepStrictEqual(result, { ok: true });
  });

  it('gate2 with no toggles → ok:true', () => {
    const result = checkGatePreconditions(
      'gate2', 'pending',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: null },
      { env: ENV_OFF },
    );
    assert.deepStrictEqual(result, { ok: true });
  });

  it('commit with no toggles → ok:true', () => {
    const result = checkGatePreconditions(
      'commit', 'pending',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: null },
      { env: ENV_OFF },
    );
    assert.deepStrictEqual(result, { ok: true });
  });
});

// ---------------------------------------------------------------------------
// AC-6 (status guard): non-pending status → ok:true regardless of toggle
// ---------------------------------------------------------------------------

describe('AC-6: status guard inside helper', () => {
  it('status=approved → ok:true even with gate1 toggle on', () => {
    const result = checkGatePreconditions(
      'gate1', 'approved',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: null },
      { env: ENV_G1 },
    );
    assert.deepStrictEqual(result, { ok: true });
  });

  it('status=discarded → ok:true even with gate1 toggle on', () => {
    const result = checkGatePreconditions(
      'gate1', 'discarded',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: null },
      { env: ENV_G1 },
    );
    assert.deepStrictEqual(result, { ok: true });
  });

  it('status=future-value → ok:true (guard covers future additions)', () => {
    const result = checkGatePreconditions(
      'gate1', 'future-status',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: null },
      { env: ENV_G1 },
    );
    assert.deepStrictEqual(result, { ok: true });
  });
});

// ---------------------------------------------------------------------------
// AC-3: gate1 preconditions
// ---------------------------------------------------------------------------

describe('AC-3: gate1 preconditions', () => {
  it('toggle off → ok:true (no filesystem check)', () => {
    const result = checkGatePreconditions(
      'gate1', 'pending',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: null },
      { env: ENV_OFF },
    );
    assert.deepStrictEqual(result, { ok: true });
  });

  it('toggle on + reviewer-output has files → ok:true', () => {
    const root = makeTempProject();
    try {
      writeFileSync(join(root, '.pipeline', 'context', 'reviewer-output', 'reviewer-safety.md'), 'APPROVED');
      const result = checkGatePreconditions(
        'gate1', 'pending',
        { worktreePath: null, projectRoot: root, agents: [], createdAt: null },
        { env: ENV_G1 },
      );
      assert.deepStrictEqual(result, { ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('toggle on + reviewer-* agent in trail → ok:true', () => {
    const root = makeTempProject();
    try {
      const agents = [
        { agentId: 'a1', agentType: 'reviewer-safety', startedAt: Date.now(), completedAt: null, outcome: 'APPROVED', durationMs: null },
      ];
      const result = checkGatePreconditions(
        'gate1', 'pending',
        { worktreePath: null, projectRoot: root, agents, createdAt: null },
        { env: ENV_G1 },
      );
      assert.deepStrictEqual(result, { ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('toggle on + empty reviewer-output + no reviewer agents → ok:false; message contains "reviewer" or "Gate 1 requires"', () => {
    const root = makeTempProject();
    try {
      const result = checkGatePreconditions(
        'gate1', 'pending',
        { worktreePath: null, projectRoot: root, agents: [], createdAt: null },
        { env: ENV_G1 },
      );
      assert.strictEqual(result.ok, false);
      assert.ok(
        result.message.includes('reviewer') || result.message.includes('Gate 1 requires'),
        `message must contain "reviewer" or "Gate 1 requires", got: ${result.message}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('toggle on + worktreePath set but dir missing → treated as empty → ok:false', () => {
    const root = makeTempProject();
    const missingWorktree = join(root, 'nonexistent-worktree');
    try {
      const result = checkGatePreconditions(
        'gate1', 'pending',
        { worktreePath: missingWorktree, projectRoot: root, agents: [], createdAt: null },
        { env: ENV_G1 },
      );
      assert.strictEqual(result.ok, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('toggle on + worktreePath non-null → uses worktree reviewer-output path, not projectRoot', () => {
    const root = makeTempProject();
    const wt = mkdtempSync(join(tmpdir(), 'forge-wt-'));
    try {
      // Put reviewer file in worktree path only (not in projectRoot)
      mkdirSync(join(wt, '.pipeline', 'context', 'reviewer-output'), { recursive: true });
      writeFileSync(join(wt, '.pipeline', 'context', 'reviewer-output', 'reviewer.md'), 'APPROVED');
      const result = checkGatePreconditions(
        'gate1', 'pending',
        { worktreePath: wt, projectRoot: root, agents: [], createdAt: null },
        { env: ENV_G1 },
      );
      assert.deepStrictEqual(result, { ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it('toggle on + worktreePath null → uses projectRoot reviewer-output path', () => {
    const root = makeTempProject();
    const wt = mkdtempSync(join(tmpdir(), 'forge-wt-'));
    try {
      // worktreePath is null — reviewer file in projectRoot (not in wt)
      writeFileSync(join(root, '.pipeline', 'context', 'reviewer-output', 'reviewer.md'), 'APPROVED');
      const result = checkGatePreconditions(
        'gate1', 'pending',
        { worktreePath: null, projectRoot: root, agents: [], createdAt: null },
        { env: ENV_G1 },
      );
      assert.deepStrictEqual(result, { ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-4: gate2 preconditions
// ---------------------------------------------------------------------------

describe('AC-4: gate2 preconditions', () => {
  it('toggle off → ok:true', () => {
    const result = checkGatePreconditions(
      'gate2', 'pending',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: null },
      { env: ENV_OFF },
    );
    assert.deepStrictEqual(result, { ok: true });
  });

  it('toggle on + all three conditions fail → ok:false; message contains "handoff" or "implementation"', () => {
    const root = makeTempProject();
    try {
      const result = checkGatePreconditions(
        'gate2', 'pending',
        { worktreePath: null, projectRoot: root, agents: [], createdAt: null },
        { env: ENV_G2 },
      );
      assert.strictEqual(result.ok, false);
      assert.ok(
        result.message.includes('handoff') || result.message.includes('implementation'),
        `message must contain "handoff" or "implementation", got: ${result.message}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('toggle on + handoff.md exists → ok:true (condition 1 satisfied)', () => {
    const root = makeTempProject();
    try {
      writeFileSync(join(root, 'docs', 'context', 'handoff.md'), '# Handoff');
      const result = checkGatePreconditions(
        'gate2', 'pending',
        { worktreePath: null, projectRoot: root, agents: [], createdAt: null },
        { env: ENV_G2 },
      );
      assert.deepStrictEqual(result, { ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('toggle on + coder agent outcome=completed → ok:true (condition 2 satisfied)', () => {
    const root = makeTempProject();
    try {
      const agents = [
        { agentId: 'a1', agentType: 'coder', startedAt: Date.now(), completedAt: Date.now(), outcome: 'completed', durationMs: 1 },
      ];
      const result = checkGatePreconditions(
        'gate2', 'pending',
        { worktreePath: null, projectRoot: root, agents, createdAt: null },
        { env: ENV_G2 },
      );
      assert.deepStrictEqual(result, { ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('toggle on + debug agent outcome=partial → ok:true (condition 2 satisfied)', () => {
    const root = makeTempProject();
    try {
      const agents = [
        { agentId: 'a1', agentType: 'debug', startedAt: Date.now(), completedAt: Date.now(), outcome: 'partial', durationMs: 1 },
      ];
      const result = checkGatePreconditions(
        'gate2', 'pending',
        { worktreePath: null, projectRoot: root, agents, createdAt: null },
        { env: ENV_G2 },
      );
      assert.deepStrictEqual(result, { ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('toggle on + refactor agent outcome=completed → ok:true (condition 2 satisfied)', () => {
    const root = makeTempProject();
    try {
      const agents = [
        { agentId: 'a1', agentType: 'refactor', startedAt: Date.now(), completedAt: Date.now(), outcome: 'completed', durationMs: 1 },
      ];
      const result = checkGatePreconditions(
        'gate2', 'pending',
        { worktreePath: null, projectRoot: root, agents, createdAt: null },
        { env: ENV_G2 },
      );
      assert.deepStrictEqual(result, { ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('toggle on + reviewer-output has files → ok:true (condition 3 satisfied)', () => {
    const root = makeTempProject();
    try {
      writeFileSync(join(root, '.pipeline', 'context', 'reviewer-output', 'r.md'), 'content');
      const result = checkGatePreconditions(
        'gate2', 'pending',
        { worktreePath: null, projectRoot: root, agents: [], createdAt: null },
        { env: ENV_G2 },
      );
      assert.deepStrictEqual(result, { ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('toggle on + worktreePath non-null + handoff.md in worktree → ok:true', () => {
    const root = makeTempProject();
    const wt = mkdtempSync(join(tmpdir(), 'forge-wt-'));
    try {
      mkdirSync(join(wt, 'docs', 'context'), { recursive: true });
      writeFileSync(join(wt, 'docs', 'context', 'handoff.md'), '# Handoff');
      const result = checkGatePreconditions(
        'gate2', 'pending',
        { worktreePath: wt, projectRoot: root, agents: [], createdAt: null },
        { env: ENV_G2 },
      );
      assert.deepStrictEqual(result, { ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it('toggle on + worktreePath set but missing → treated as empty → ok:false when all conditions fail', () => {
    const root = makeTempProject();
    const missingWt = join(root, 'nonexistent');
    try {
      const result = checkGatePreconditions(
        'gate2', 'pending',
        { worktreePath: missingWt, projectRoot: root, agents: [], createdAt: null },
        { env: ENV_G2 },
      );
      assert.strictEqual(result.ok, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-5: commit gate preconditions
// ---------------------------------------------------------------------------

describe('AC-5: commit gate preconditions', () => {
  it('toggle off → ok:true', () => {
    const result = checkGatePreconditions(
      'commit', 'pending',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: null },
      { env: ENV_OFF },
    );
    assert.deepStrictEqual(result, { ok: true });
  });

  it('toggle on + documenter in agents trail → ok:true (no git check)', () => {
    const agents = [
      { agentId: 'a1', agentType: 'documenter', startedAt: Date.now(), completedAt: null, outcome: null, durationMs: null },
    ];
    const neverCallGit = () => { throw new Error('git must not be called when documenter is present'); };
    const result = checkGatePreconditions(
      'commit', 'pending',
      { worktreePath: null, projectRoot: '/fake', agents, createdAt: null },
      { env: ENV_CM, execFileSync: neverCallGit },
    );
    assert.deepStrictEqual(result, { ok: true });
  });

  it('toggle on + no documenter + git returns feat(forge): commit → ok:true', () => {
    const mockGit = () => 'feat(forge): apply some changes\n';
    const result = checkGatePreconditions(
      'commit', 'pending',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: '2026-01-01T00:00:00.000Z' },
      { env: ENV_CM, execFileSync: mockGit },
    );
    assert.deepStrictEqual(result, { ok: true });
  });

  it('toggle on + no documenter + git returns empty → ok:false; message contains "documenter" or "apply commit"', () => {
    const mockGit = () => '';
    const result = checkGatePreconditions(
      'commit', 'pending',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: '2026-01-01T00:00:00.000Z' },
      { env: ENV_CM, execFileSync: mockGit },
    );
    assert.strictEqual(result.ok, false);
    assert.ok(
      result.message.includes('documenter') || result.message.includes('apply commit'),
      `message must contain "documenter" or "apply commit", got: ${result.message}`,
    );
  });

  it('toggle on + no documenter + git returns non-forge commit → ok:false', () => {
    const mockGit = () => 'chore: some unrelated commit\nfix: another commit\n';
    const result = checkGatePreconditions(
      'commit', 'pending',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: '2026-01-01T00:00:00.000Z' },
      { env: ENV_CM, execFileSync: mockGit },
    );
    assert.strictEqual(result.ok, false);
  });

  it('toggle on + no documenter + git throws (unavailable) → fails-open → ok:true', () => {
    const mockGit = () => { throw new Error('git: command not found'); };
    const result = checkGatePreconditions(
      'commit', 'pending',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: '2026-01-01T00:00:00.000Z' },
      { env: ENV_CM, execFileSync: mockGit },
    );
    assert.deepStrictEqual(result, { ok: true });
  });

  it('toggle on + no documenter + git throws ENOENT → fails-open → ok:true', () => {
    const err = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
    const mockGit = () => { throw err; };
    const result = checkGatePreconditions(
      'commit', 'pending',
      { worktreePath: null, projectRoot: '/fake', agents: [], createdAt: '2026-01-01T00:00:00.000Z' },
      { env: ENV_CM, execFileSync: mockGit },
    );
    assert.deepStrictEqual(result, { ok: true });
  });
});

// ---------------------------------------------------------------------------
// AC-6: forge_set_gate integration — precondition enforcement via fake-server
// ---------------------------------------------------------------------------

describe('AC-6: forge_set_gate integration — precondition rejection', () => {
  let tmpRoot;
  let savedProjectDir;
  let setGateHandler;

  before(() => {
    // Create temp project with .pipeline/ and a fake run
    tmpRoot = mkdtempSync(join(tmpdir(), 'forge-int-'));
    mkdirSync(join(tmpRoot, '.pipeline', 'context', 'reviewer-output'), { recursive: true });
    mkdirSync(join(tmpRoot, '.pipeline', 'runs', 'r-inttest1'), { recursive: true });

    // Minimal valid run.json
    const run = {
      runId: 'r-inttest1',
      sessionId: 'test-session',
      projectRoot: tmpRoot,
      worktreePath: null,
      branchName: null,
      pipelineType: 'implement',
      feature: 'test feature',
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      gateState: null,
      agents: [],
      artifacts: { plan: null, handoff: null, scout: null },
      mergeBlocked: null,
      failureReason: null,
      parentRunId: null,
      stages: null,
      classificationId: null,
      reviewerOverrides: [],
      phases: null,
      acknowledged: false,
    };
    writeFileSync(
      join(tmpRoot, '.pipeline', 'runs', 'r-inttest1', 'run.json'),
      JSON.stringify(run, null, 2),
    );

    // Minimal index so listRuns doesn't error
    const index = {
      runs: [{
        runId: 'r-inttest1',
        pipelineType: 'implement',
        feature: 'test feature',
        status: 'running',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        parentRunId: null,
        classificationId: null,
      }],
    };
    writeFileSync(
      join(tmpRoot, '.pipeline', 'runs', 'index.json'),
      JSON.stringify(index, null, 2),
    );

    // Route resolveProjectDir() to our temp project
    savedProjectDir = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = tmpRoot;

    // Register tools with a fake server that captures handlers
    const tools = {};
    const fakeServer = {
      registerTool: (name, _schema, handler) => { tools[name] = handler; },
    };
    register(fakeServer, {});
    setGateHandler = tools['forge_set_gate'];
  });

  after(() => {
    // Restore env
    if (savedProjectDir === undefined) {
      delete process.env.CLAUDE_PROJECT_DIR;
    } else {
      process.env.CLAUDE_PROJECT_DIR = savedProjectDir;
    }
    // Clean up temp project
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  });

  it('gate1 toggle on + no reviewer output → isError:true with no absolute path in message', async () => {
    process.env.FORGE_GATE_PRECONDITION_GATE1 = 'on';
    try {
      const result = await setGateHandler({
        gate: 'gate1', feature: 'test feature', status: 'pending', runId: 'r-inttest1',
      });
      assert.strictEqual(result.isError, true, 'expected isError:true');
      assert.ok(Array.isArray(result.content), 'expected content array');
      assert.strictEqual(result.content.length, 1);
      const text = result.content[0].text;
      assert.ok(typeof text === 'string');
      // Message must NOT contain absolute filesystem paths
      assert.ok(
        !text.includes(tmpRoot),
        `message must not contain absolute path, got: ${text}`,
      );
    } finally {
      delete process.env.FORGE_GATE_PRECONDITION_GATE1;
    }
  });

  it('gate1 toggle off → no precondition error (gate proceeds normally)', async () => {
    // Toggle is not set — precondition check is skipped
    const result = await setGateHandler({
      gate: 'gate1', feature: 'test feature', status: 'pending', runId: 'r-inttest1',
    });
    // If there's an error, it must NOT be a precondition error
    if (result.isError) {
      const text = result.content?.[0]?.text ?? '';
      assert.ok(
        !text.includes('Gate 1 requires') && !text.includes('No reviewer output'),
        `unexpected precondition error with toggle off: ${text}`,
      );
    } else {
      // Success — gate was written
      assert.ok(result.content?.[0]?.text, 'expected content text');
    }
  });
});
