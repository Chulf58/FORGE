#!/usr/bin/env node
'use strict';

// @covers hooks/bash-guard.js
//
// Tests that BLOCKED_COMMANDS (tool-choice enforcement) and
// GIT_HARD_BLOCKED_PATTERNS (generic git hygiene) have been removed from
// bash-guard.js, while the three FORGE-specific guards survive intact:
//   1. Control-file write guard
//   2. Commit-gate hard-block
//   3. Commit/push soft-block
//
// Wave 1 (red): T1, T2, T3 will FAIL because bash-guard still has the
//   old BLOCKED_COMMANDS and GIT_HARD_BLOCKED_PATTERNS checks.
// Wave 2 (green): all 5 tests pass after the old checks are removed.
//
// Run: node hooks/bash-guard-narrowing-test.js

const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { spawn } = require('child_process');

const BASH_GUARD = join(__dirname, 'bash-guard.js');
const PLUGIN_ROOT = join(__dirname, '..');

function runHook(payload, projectDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BASH_GUARD], {
      cwd: projectDir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on('error', reject);
  });
}

function makeTmpProject() {
  const tmp = mkdtempSync(join(tmpdir(), 'bash-guard-narrowing-test-'));
  mkdirSync(join(tmp, '.pipeline', 'runs'), { recursive: true });
  writeFileSync(join(tmp, '.pipeline', 'project.json'), '{"name":"test"}', 'utf8');
  return tmp;
}

function makeTmpDir() {
  // Empty dir — no project.json, so isProjectInitialized returns false.
  // Control-file guard and git guards skip for uninitialized projects.
  return mkdtempSync(join(tmpdir(), 'bash-guard-narrowing-empty-'));
}

function writeApprovalToken(projectDir, actions, ttlMs) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (ttlMs || 120000));
  writeFileSync(
    join(projectDir, '.pipeline', 'action-approved.json'),
    JSON.stringify({
      actions,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      source: 'test',
    }, null, 2) + '\n',
    'utf8',
  );
}

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { console.log('  PASS  ' + label); passed++; }
  else { console.error('  FAIL  ' + label); failed++; }
}

async function test() {
  console.log('\n── bash-guard-narrowing-test.js ─────────────────────────────────────');
  console.log('  Verifies BLOCKED_COMMANDS and GIT_HARD_BLOCKED_PATTERNS are removed.\n');

  // T1 — `cat foo.txt` must be ALLOWED (not blocked by BLOCKED_COMMANDS).
  // Previously bash-guard blocked cat unconditionally; after the fix it exits 0.
  {
    const dir = makeTmpDir();
    try {
      const payload = {
        tool_name: 'Bash',
        tool_input: { command: 'cat foo.txt' },
        cwd: dir,
      };
      const res = await runHook(payload, dir);
      assert(res.code === 0,
        'T1 `cat foo.txt` ALLOWED — not a FORGE safety concern (code=' + res.code + ' stderr=' + res.stderr + ')');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // T2 — `find . -name "*.js"` must be ALLOWED (not blocked by BLOCKED_COMMANDS).
  {
    const dir = makeTmpDir();
    try {
      const payload = {
        tool_name: 'Bash',
        tool_input: { command: 'find . -name "*.js"' },
        cwd: dir,
      };
      const res = await runHook(payload, dir);
      assert(res.code === 0,
        'T2 `find . -name "*.js"` ALLOWED — not a FORGE safety concern (code=' + res.code + ' stderr=' + res.stderr + ')');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // T3 — `git commit --amend --no-edit` with a valid approval token must be ALLOWED.
  // Previously GIT_HARD_BLOCKED_PATTERNS hard-blocked --amend regardless of token.
  {
    const dir = makeTmpProject();
    try {
      writeApprovalToken(dir, ['commit']);
      const payload = {
        tool_name: 'Bash',
        tool_input: { command: 'git commit --amend --no-edit' },
        cwd: dir,
      };
      const res = await runHook(payload, dir);
      assert(res.code === 0,
        'T3 `git commit --amend` ALLOWED when approval token present (code=' + res.code + ' stderr=' + res.stderr + ')');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // T4 — `node -e "require('fs').writeFileSync('.pipeline/project.json', '{}')"` must be BLOCKED.
  // Control-file write guard must still fire (FORGE-specific invariant).
  {
    const dir = makeTmpProject();
    try {
      const payload = {
        tool_name: 'Bash',
        // Single-quoted inner string to avoid escaping issues in the JSON payload
        tool_input: { command: "node -e \"require('fs').writeFileSync('.pipeline/project.json', '{}')\"" },
        cwd: dir,
      };
      const res = await runHook(payload, dir);
      assert(res.code === 2,
        'T4 node -e write to .pipeline/project.json BLOCKED by control-file guard (code=' + res.code + ')');
      assert(
        res.stderr.includes('bash-guard') || res.stdout.includes('bash-guard'),
        'T4 block message mentions bash-guard',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // T5 — `git commit -m "message"` with no token, no active run → soft-block fires.
  // Soft-block is a FORGE-specific invariant and must survive the narrowing.
  {
    const dir = makeTmpProject();
    try {
      const payload = {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "message"' },
        cwd: dir,
      };
      const res = await runHook(payload, dir);
      assert(res.code === 2,
        'T5 `git commit` without approval token BLOCKED by soft-block (code=' + res.code + ')');
      assert(
        res.stderr.includes('explicit user approval') || res.stdout.includes('explicit user approval'),
        'T5 soft-block message mentions explicit user approval',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // T6 — `git reset --hard HEAD~1` with valid approval token → ALLOW.
  // Previously GIT_HARD_BLOCKED_PATTERNS blocked this regardless of token.
  // After fix: --hard is not hard-blocked; soft-block applies to push/commit only.
  // git reset is not in GIT_SOFT_BLOCKED so it falls through to exit 0.
  {
    const dir = makeTmpProject();
    try {
      writeApprovalToken(dir, ['commit']);
      const payload = {
        tool_name: 'Bash',
        tool_input: { command: 'git reset --hard HEAD~1' },
        cwd: dir,
      };
      const res = await runHook(payload, dir);
      assert(res.code === 0,
        'T6 `git reset --hard` ALLOWED after removing GIT_HARD_BLOCKED_PATTERNS (code=' + res.code + ' stderr=' + res.stderr + ')');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('\n  ' + (passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed === 0 ? 0 : 1);
}

test().catch((err) => { console.error(err); process.exit(1); });
