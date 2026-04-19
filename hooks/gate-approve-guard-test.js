#!/usr/bin/env node
'use strict';

// Tests for the gate self-approval guard:
//   1. approval-token.js generates 'gate-approve' from "approve" in user message
//   2. workflow-guard.js blocks Write/Edit to gate-pending.json with "approved"
//      status when no approval token exists
//   3. workflow-guard.js allows the same writes when a valid token is present
//   4. Unrelated writes are unaffected
//
// Run: node hooks/gate-approve-guard-test.js

const { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { spawn } = require('child_process');

const APPROVAL_TOKEN_HOOK = join(__dirname, 'approval-token.js');
const WORKFLOW_GUARD_HOOK = join(__dirname, 'workflow-guard.js');
const PLUGIN_ROOT = join(__dirname, '..');

function runHook(hookPath, payload, projectDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookPath], {
      cwd: projectDir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on('error', reject);
  });
}

function writeApprovalToken(projectDir, actions, ttlMs) {
  const pipelineDir = join(projectDir, '.pipeline');
  mkdirSync(pipelineDir, { recursive: true });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (ttlMs || 120000));
  writeFileSync(
    join(pipelineDir, 'action-approved.json'),
    JSON.stringify({
      actions,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      source: 'test',
    }, null, 2) + '\n',
    'utf8',
  );
}

function makeTmpProject() {
  const tmp = mkdtempSync(join(tmpdir(), 'gate-approve-test-'));
  mkdirSync(join(tmp, '.pipeline'), { recursive: true });
  return tmp;
}

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { console.log('  PASS  ' + label); passed++; }
  else       { console.error('  FAIL  ' + label); failed++; }
}

async function test() {
  console.log('\n── gate-approve-guard-test.js ───────────────────────────────────────────');

  // ── approval-token.js tests ──────────────────────────────────────────

  // 1. "approve" in user message → generates gate-approve token
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      message: { content: '/forge:approve' },
    }, tmp);
    const tokenPath = join(tmp, '.pipeline', 'action-approved.json');
    const exists = existsSync(tokenPath);
    assert(exists, 'approval-token: /forge:approve creates token file');
    if (exists) {
      const data = JSON.parse(readFileSync(tokenPath, 'utf8'));
      assert(data.actions.includes('gate-approve'),
        'approval-token: token includes gate-approve action');
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  // 2. "yes approve it" in user message → generates gate-approve token
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      message: { content: 'yes approve it' },
    }, tmp);
    const tokenPath = join(tmp, '.pipeline', 'action-approved.json');
    const exists = existsSync(tokenPath);
    assert(exists, 'approval-token: "yes approve it" creates token file');
    if (exists) {
      const data = JSON.parse(readFileSync(tokenPath, 'utf8'));
      assert(data.actions.includes('gate-approve'),
        'approval-token: token includes gate-approve action');
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  // 3. Negated approve → no gate-approve token (but may have other actions)
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      message: { content: "don't approve this" },
    }, tmp);
    const tokenPath = join(tmp, '.pipeline', 'action-approved.json');
    if (existsSync(tokenPath)) {
      const data = JSON.parse(readFileSync(tokenPath, 'utf8'));
      assert(!data.actions.includes('gate-approve'),
        'approval-token: negated approve does NOT include gate-approve');
    } else {
      assert(true, 'approval-token: negated approve does NOT create token');
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  // 4. No approve keyword → no gate-approve token
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      message: { content: 'just checking the status' },
    }, tmp);
    const tokenPath = join(tmp, '.pipeline', 'action-approved.json');
    if (existsSync(tokenPath)) {
      const data = JSON.parse(readFileSync(tokenPath, 'utf8'));
      assert(!data.actions.includes('gate-approve'),
        'approval-token: unrelated message does NOT include gate-approve');
    } else {
      assert(true, 'approval-token: unrelated message creates no token');
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  // ── workflow-guard.js Write tests ────────────────────────────────────

  // 5. Write gate-pending.json with approved + no token → blocked
  {
    const tmp = makeTmpProject();
    const content = JSON.stringify({ gate: 'gate2', status: 'approved', feature: 'test' });
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const { code, stdout } = await runHook(WORKFLOW_GUARD_HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 2, 'workflow-guard: Write approved + no token → exit 2 (blocked)');
    assert(stdout.includes('self-approval') || stdout.includes('user authorization'),
      'workflow-guard: block message explains gate approval requirement');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 6. Write gate-pending.json with approved + valid token → allowed
  {
    const tmp = makeTmpProject();
    writeApprovalToken(tmp, ['gate-approve'], 120000);
    const content = JSON.stringify({ gate: 'gate2', status: 'approved', feature: 'test' });
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const { code } = await runHook(WORKFLOW_GUARD_HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 0, 'workflow-guard: Write approved + valid token → exit 0 (allowed)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 7. Write gate-pending.json with pending status + no token → allowed
  {
    const tmp = makeTmpProject();
    const content = JSON.stringify({ gate: 'gate2', status: 'pending', feature: 'test' });
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const { code } = await runHook(WORKFLOW_GUARD_HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 0, 'workflow-guard: Write pending + no token → exit 0 (allowed)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 8. Edit gate-pending.json with "approved" in new_string + no token → blocked
  {
    const tmp = makeTmpProject();
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const { code } = await runHook(WORKFLOW_GUARD_HOOK, {
      tool_name: 'Edit',
      tool_input: {
        file_path: filePath,
        old_string: '"pending"',
        new_string: '"approved"',
      },
    }, tmp);
    assert(code === 2, 'workflow-guard: Edit approved + no token → exit 2 (blocked)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 9. Edit gate-pending.json with "approved" in new_string + valid token → allowed
  {
    const tmp = makeTmpProject();
    writeApprovalToken(tmp, ['gate-approve'], 120000);
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const { code } = await runHook(WORKFLOW_GUARD_HOOK, {
      tool_name: 'Edit',
      tool_input: {
        file_path: filePath,
        old_string: '"pending"',
        new_string: '"approved"',
      },
    }, tmp);
    assert(code === 0, 'workflow-guard: Edit approved + valid token → exit 0 (allowed)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 10. Write to a different file → unaffected (no gate check)
  {
    const tmp = makeTmpProject();
    const filePath = join(tmp, 'some-other-file.json');
    const content = JSON.stringify({ status: 'approved' });
    const { code } = await runHook(WORKFLOW_GUARD_HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 0, 'workflow-guard: Write to non-gate file → exit 0 (unaffected)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 11. Expired token → blocked
  {
    const tmp = makeTmpProject();
    writeApprovalToken(tmp, ['gate-approve'], -1000); // already expired
    const content = JSON.stringify({ gate: 'gate2', status: 'approved', feature: 'test' });
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const { code } = await runHook(WORKFLOW_GUARD_HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 2, 'workflow-guard: Write approved + expired token → exit 2 (blocked)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 12. Token with commit/push but not gate-approve → blocked
  {
    const tmp = makeTmpProject();
    writeApprovalToken(tmp, ['commit', 'push'], 120000);
    const content = JSON.stringify({ gate: 'gate2', status: 'approved', feature: 'test' });
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const { code } = await runHook(WORKFLOW_GUARD_HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 2, 'workflow-guard: Write approved + wrong action token → exit 2 (blocked)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 13. Non-JSON Write to gate-pending.json with "approved" string → blocked
  {
    const tmp = makeTmpProject();
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const content = 'some text with "status": "approved" in it';
    const { code } = await runHook(WORKFLOW_GUARD_HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 2, 'workflow-guard: non-JSON Write with approved pattern → exit 2 (blocked)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 14. Non-Agent tool call (Bash) passes through workflow-guard
  {
    const tmp = makeTmpProject();
    const { code } = await runHook(WORKFLOW_GUARD_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
    }, tmp);
    assert(code === 0, 'workflow-guard: Bash tool call → exit 0 (not Write/Edit)');
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log('');
  console.log('  ' + (passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(e => { console.error(e); process.exit(1); });
