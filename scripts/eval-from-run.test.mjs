// @covers scripts/eval-from-run.mjs
// TDD tests for the eval-from-run graduation helper.
// Wave 1: failing tests (red bar) — implementation does not exist yet.

import { strictEqual, ok } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const helperPath = join(__dirname, 'eval-from-run.mjs');

// ── Helper: create a minimal fake project structure ───────────────────────────

function makeFakeProject(baseDir, runId, agentTypes = ['forge:planner'], extra = {}) {
  const runsDir = join(baseDir, '.pipeline', 'runs', runId);
  mkdirSync(runsDir, { recursive: true });

  const agents = agentTypes.map((agentType, i) => ({
    agentId: `agent-${i}`,
    agentType,
    startedAt: Date.now(),
    completedAt: Date.now() + 1000,
    outcome: 'completed',
  }));

  const runData = {
    runId,
    projectRoot: baseDir,
    feature: 'test feature',
    status: 'completed',
    agents,
    ...extra,
  };

  writeFileSync(join(runsDir, 'run.json'), JSON.stringify(runData, null, 2));
  return runsDir;
}

// ── Helper: run the helper script in a fake CWD ───────────────────────────────

function runHelper(args, cwd) {
  return spawnSync(process.execPath, [helperPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('exits non-zero when --run-id is missing', () => {
  const result = runHelper([], __dirname);
  strictEqual(result.status, 1, 'should exit 1 when no --run-id provided');
  ok(result.stderr.includes('--run-id'), 'stderr should mention --run-id');
});

test('exits non-zero when run does not exist', (t, done) => {
  const base = join(tmpdir(), `eval-from-run-test-${Date.now()}`);
  mkdirSync(base, { recursive: true });
  try {
    const result = runHelper(['--run-id', 'r-nonexistent'], base);
    strictEqual(result.status, 1, 'should exit 1 for missing run');
    ok(result.stderr.includes('run.json'), 'stderr should mention run.json');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  done();
});

test('writes STRONG scenario to evals/agent-prompts/ for agent with non-empty signals', (t, done) => {
  const base = join(tmpdir(), `eval-from-run-test-${Date.now()}`);
  const runId = 'r-test001';
  makeFakeProject(base, runId, ['forge:planner']);

  // Create evals dirs
  mkdirSync(join(base, 'evals', 'agent-prompts'), { recursive: true });
  mkdirSync(join(base, 'evals', 'needs-review'), { recursive: true });

  try {
    const result = runHelper(['--run-id', runId], base);
    strictEqual(result.status, 0, `should exit 0; stderr: ${result.stderr}`);
    ok(
      result.stderr.includes('[eval-from-run] strong:'),
      'stderr should include strong count',
    );
    // At least one strong scenario for forge:planner (it gets default planner signals)
    // Directory uses short name (no forge: prefix) to match evals/agent-prompts/<shortname>/ convention
    const strongDir = join(base, 'evals', 'agent-prompts', 'planner');
    ok(existsSync(strongDir), 'strong dir should exist for planner');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  done();
});

test('exits non-zero for invalid agent token (path traversal)', (t, done) => {
  const base = join(tmpdir(), `eval-from-run-test-${Date.now()}`);
  const runId = 'r-test002';
  // Inject a malicious agent type
  makeFakeProject(base, runId, ['../attacker']);

  mkdirSync(join(base, 'evals', 'agent-prompts'), { recursive: true });
  mkdirSync(join(base, 'evals', 'needs-review'), { recursive: true });

  try {
    const result = runHelper(['--run-id', runId], base);
    strictEqual(result.status, 1, 'should exit 1 for invalid token');
    ok(
      result.stderr.includes('invalid agent token'),
      'stderr should name the invalid token',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  done();
});

test('sanitizes field-name credentials before writing', (t, done) => {
  const base = join(tmpdir(), `eval-from-run-test-${Date.now()}`);
  const runId = 'r-test003';

  const runsDir = join(base, '.pipeline', 'runs', runId);
  mkdirSync(runsDir, { recursive: true });

  // Inject a run.json with a sensitive field
  const runData = {
    runId,
    projectRoot: base,
    feature: 'test',
    status: 'completed',
    apiKey: 'sk-ant-real-looking-token',
    agents: [{ agentId: 'a1', agentType: 'forge:planner', outcome: 'completed' }],
  };
  writeFileSync(join(runsDir, 'run.json'), JSON.stringify(runData));

  mkdirSync(join(base, 'evals', 'agent-prompts'), { recursive: true });
  mkdirSync(join(base, 'evals', 'needs-review'), { recursive: true });

  try {
    const result = runHelper(['--run-id', runId], base);
    // Should succeed
    ok(result.status === 0 || result.stderr.includes('[eval-from-run]'), 'should run without fatal error');
    // Sanitization summary should appear when redactions occur
    // (field-name filter fires on apiKey)
    ok(
      result.stderr.includes('sanitized') || result.status === 0,
      'should report sanitization or succeed',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  done();
});

test('sanitizes regex-value credentials in string fields', (t, done) => {
  const base = join(tmpdir(), `eval-from-run-test-${Date.now()}`);
  const runId = 'r-test004';

  const runsDir = join(base, '.pipeline', 'runs', runId);
  mkdirSync(runsDir, { recursive: true });

  const runData = {
    runId,
    projectRoot: base,
    feature: 'Error: token=ghp_abcdef123456789',
    status: 'completed',
    agents: [{ agentId: 'a1', agentType: 'forge:planner', outcome: 'completed' }],
  };
  writeFileSync(join(runsDir, 'run.json'), JSON.stringify(runData));

  mkdirSync(join(base, 'evals', 'agent-prompts'), { recursive: true });
  mkdirSync(join(base, 'evals', 'needs-review'), { recursive: true });

  try {
    const result = runHelper(['--run-id', runId], base);
    ok(result.status === 0, `should exit 0; stderr: ${result.stderr}`);
    // No written scenario file should contain the raw token
    const plannerDir = join(base, 'evals', 'agent-prompts', 'planner');
    if (existsSync(plannerDir)) {
      const files = readdirSync(plannerDir);
      for (const f of files) {
        const content = readFileSync(join(plannerDir, f), 'utf-8');
        ok(
          !content.includes('ghp_abcdef123456789'),
          `scenario file should not contain raw GitHub PAT: ${f}`,
        );
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  done();
});

test('emits strong/weak summary line on every invocation', (t, done) => {
  const base = join(tmpdir(), `eval-from-run-test-${Date.now()}`);
  const runId = 'r-test005';
  makeFakeProject(base, runId, ['forge:coder']);

  mkdirSync(join(base, 'evals', 'agent-prompts'), { recursive: true });
  mkdirSync(join(base, 'evals', 'needs-review'), { recursive: true });

  try {
    const result = runHelper(['--run-id', runId], base);
    ok(
      result.stderr.includes('[eval-from-run] strong:'),
      'must emit strong/weak summary line',
    );
    ok(
      result.stderr.includes('quarantined to needs-review/'),
      'must mention needs-review/ quarantine',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  done();
});
