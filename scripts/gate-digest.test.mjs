#!/usr/bin/env node
// @covers scripts/gate-digest.mjs
// Tests for scripts/gate-digest.mjs — gate-state digest builder.
//
// AC cases:
//   (1) gate1 fixture → stdout contains RUN STATE + AGENT CHAIN + GATE1 headers and each agent name
//   (2) gate1 with broken Verify line (missing oracle) → stdout contains 'Verify-gate: FAIL — task <N>'
//   (3) commit-gate with one uncommitted file → stdout contains 'Uncommitted: <path>'
//   (4) AC-4 source-scan: script does NOT contain forge_set_gate/forge_update_run/writeFileSync/writeFile/appendFile/createWriteStream
//
// Run: node --test scripts/gate-digest.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./gate-digest.mjs', import.meta.url));

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-digest-test-'));
}

function writeJson(dir, relPath, obj) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(obj, null, 2), 'utf8');
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function runScript(rootDir, runId) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, runId, '--root', rootDir], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

function gitExec(worktreeDir, args) {
  try {
    return execFileSync('git', ['-C', worktreeDir, ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    throw err;
  }
}

// --- Tests -------------------------------------------------------------------

test('(1) gate1 fixture → stdout contains RUN STATE, AGENT CHAIN, GATE1 sections and agent names', () => {
  const tmpRoot = makeTmpDir();
  try {
    const runId = 'run-12345';
    const runDir = path.join(tmpRoot, '.pipeline', 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });

    // Fixture run.json with gate1 state
    writeJson(runDir, 'run.json', {
      runId,
      feature: 'test-feature',
      gate: 'gate1',
      gateState: {
        gate: 'gate1',
        status: 'pending',
      },
      classificationId: 'feature',
      agents: [
        {
          agentType: 'brainstormer',
          outcome: 'completed',
          verdict: 'APPROVED',
        },
        {
          agentType: 'planner',
          outcome: 'completed',
          verdict: 'APPROVED',
        },
      ],
    });

    // Minimal PLAN.md with one valid Verify line
    writeFile(tmpRoot, 'docs/PLAN.md', `# PLAN

### Feature: test-feature

- [ ] 1. Task one
  Verify when X.
  Oracle: Y.
  Observable: Z.

- [ ] 2. Task two
`);

    const result = runScript(tmpRoot, runId);

    assert.equal(result.code, 0, 'should exit 0 for gate1 fixture');
    const stdout = result.stdout || '';

    // Check for section headers
    assert.ok(stdout.includes('RUN STATE'), 'stdout contains RUN STATE header');
    assert.ok(stdout.includes('AGENT CHAIN'), 'stdout contains AGENT CHAIN header');
    assert.ok(stdout.includes('GATE1'), 'stdout contains GATE1 header');

    // Check for agent names
    assert.ok(stdout.includes('brainstormer'), 'stdout contains brainstormer agent name');
    assert.ok(stdout.includes('planner'), 'stdout contains planner agent name');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('(2) gate1 with broken Verify line (missing oracle) → stdout contains Verify-gate: FAIL message', () => {
  const tmpRoot = makeTmpDir();
  try {
    const runId = 'run-67890';
    const runDir = path.join(tmpRoot, '.pipeline', 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });

    // Fixture run.json
    writeJson(runDir, 'run.json', {
      runId,
      feature: 'bad-verify-feature',
      gate: 'gate1',
      gateState: {
        gate: 'gate1',
        status: 'pending',
      },
      classificationId: 'feature',
      agents: [],
    });

    // PLAN.md with a Verify line missing the Oracle slot
    writeFile(tmpRoot, 'docs/PLAN.md', `# PLAN

### Feature: bad-verify-feature

- [ ] 1. Task one
  Verify when condition is met.
  Observable: some result.
`);

    const result = runScript(tmpRoot, runId);

    // The digest should report the Verify failure
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const combined = stdout + '\n' + stderr;

    assert.ok(
      combined.includes('Verify-gate: FAIL') && combined.includes('task 1'),
      'stdout or stderr contains Verify-gate: FAIL — task 1 for missing oracle',
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('(3a) commit-gate with one uncommitted file → stdout contains Uncommitted: <real-path>', () => {
  const tmpRoot = makeTmpDir();
  try {
    // Initialize a real git repo
    gitExec(tmpRoot, ['init']);
    gitExec(tmpRoot, ['config', 'user.email', 'test@test.local']);
    gitExec(tmpRoot, ['config', 'user.name', 'Test User']);

    // Create and commit a baseline file so we have a real git history
    writeFile(tmpRoot, 'baseline.txt', 'committed content');
    gitExec(tmpRoot, ['add', 'baseline.txt']);
    gitExec(tmpRoot, ['commit', '-m', 'initial commit']);

    // Now create an uncommitted file
    writeFile(tmpRoot, 'uncommitted.js', 'console.log("not staged");');

    const runId = 'run-commit-test-dirty';
    const runDir = path.join(tmpRoot, '.pipeline', 'runs', runId);
    writeJson(runDir, 'run.json', {
      runId,
      feature: 'commit-feature',
      gate: 'commit',
      gateState: {
        gate: 'commit',
        status: 'pending',
      },
      classificationId: 'feature',
      worktreePath: tmpRoot,
      agents: [],
    });

    const result = runScript(tmpRoot, runId);
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const combined = stdout + '\n' + stderr;

    // Must contain "Uncommitted: " followed by a file path that includes "uncommitted.js"
    assert.ok(
      combined.includes('Uncommitted: uncommitted.js'),
      'stdout or stderr contains Uncommitted: uncommitted.js (exact file path)',
    );

    // Negative control: the fallback should NOT appear when git works
    assert.ok(
      !combined.includes('(git status unavailable)'),
      'should NOT contain git-unavailable fallback when git command succeeds',
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('(3b) commit-gate with clean repo → stdout does NOT contain Uncommitted: <path>', () => {
  const tmpRoot = makeTmpDir();
  try {
    // Initialize a real git repo
    gitExec(tmpRoot, ['init']);
    gitExec(tmpRoot, ['config', 'user.email', 'test@test.local']);
    gitExec(tmpRoot, ['config', 'user.name', 'Test User']);

    // Create .gitignore to exclude .pipeline/
    writeFile(tmpRoot, '.gitignore', '.pipeline/\n');
    gitExec(tmpRoot, ['add', '.gitignore']);

    // Create and commit a baseline file
    writeFile(tmpRoot, 'baseline.txt', 'committed content');
    gitExec(tmpRoot, ['add', 'baseline.txt']);
    gitExec(tmpRoot, ['commit', '-m', 'initial commit']);

    // DO NOT create any uncommitted files — repo is clean (except for ignored .pipeline/)

    const runId = 'run-commit-test-clean';
    const runDir = path.join(tmpRoot, '.pipeline', 'runs', runId);
    writeJson(runDir, 'run.json', {
      runId,
      feature: 'clean-commit-feature',
      gate: 'commit',
      gateState: {
        gate: 'commit',
        status: 'pending',
      },
      classificationId: 'feature',
      worktreePath: tmpRoot,
      agents: [],
    });

    const result = runScript(tmpRoot, runId);
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const combined = stdout + '\n' + stderr;

    // Must report "git status: clean"
    assert.ok(
      combined.includes('git status: clean'),
      'stdout or stderr contains git status: clean',
    );

    // Should NOT contain any "Uncommitted: " lines for real files
    // The fallback "(git status unavailable)" should NOT appear (git works)
    assert.ok(
      !combined.includes('Uncommitted: baseline'),
      'should not report baseline file as uncommitted (it is committed)',
    );
    assert.ok(
      !combined.includes('(git status unavailable)'),
      'should not report git-unavailable fallback when git works',
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('(4) AC-4: source code does NOT contain forbidden mutation calls', async () => {
  let scriptContent = null;
  try {
    scriptContent = fs.readFileSync(SCRIPT, 'utf8');
  } catch (err) {
    // File not found — this is the RED BAR for AC-4 before implementation.
    assert.fail('scripts/gate-digest.mjs does not exist yet — red bar confirmed');
  }

  // If the file exists (after implementation), check that it contains no forbidden patterns.
  if (scriptContent) {
    const forbiddenPatterns = [
      /forge_set_gate/,
      /forge_update_run/,
      /writeFileSync/,
      /\.writeFile\(/,
      /appendFile/,
      /createWriteStream/,
    ];

    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(scriptContent),
        `source must not contain ${pattern.source}`,
      );
    }
  }
});
