#!/usr/bin/env node
'use strict';

// Tests for the approval-token + gate self-approval guard system:
//   1. approval-token.js parses real Claude Code UserPromptSubmit payloads
//      (canonical shape: { prompt: "..." }) and generates correct tokens
//   2. approval-token.js also handles legacy/test payload shapes as fallbacks
//   3. workflow-guard.js blocks Write/Edit to gate-pending.json with "approved"
//      status when no approval token exists
//   4. workflow-guard.js allows the same writes when a valid token is present
//   5. Unrelated writes are unaffected
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
  writeFileSync(join(tmp, '.pipeline', 'project.json'), '{"name":"test"}', 'utf8');
  return tmp;
}

function readToken(projectDir) {
  const tokenPath = join(projectDir, '.pipeline', 'action-approved.json');
  if (!existsSync(tokenPath)) return null;
  return JSON.parse(readFileSync(tokenPath, 'utf8'));
}

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { console.log('  PASS  ' + label); passed++; }
  else       { console.error('  FAIL  ' + label); failed++; }
}

async function test() {
  console.log('\n── gate-approve-guard-test.js ───────────────────────────────────────────');

  // ── Canonical payload shape (real Claude Code: { prompt: "..." }) ─────

  // 1. Canonical shape: gate-approve via "approve" keyword
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      prompt: '/forge:approve',
      session_id: 's1',
      cwd: tmp,
    }, tmp);
    const token = readToken(tmp);
    assert(token !== null, 'canonical: /forge:approve creates token file');
    assert(token && token.actions.includes('gate-approve'),
      'canonical: token includes gate-approve action');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 2. Canonical shape: git commit token
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      prompt: 'yes go ahead and commit',
      session_id: 's1',
      cwd: tmp,
    }, tmp);
    const token = readToken(tmp);
    assert(token !== null, 'canonical: "commit" creates token file');
    assert(token && token.actions.includes('commit'),
      'canonical: token includes commit action');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 3. Canonical shape: git push token
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      prompt: 'push it to remote',
      session_id: 's1',
      cwd: tmp,
    }, tmp);
    const token = readToken(tmp);
    assert(token !== null, 'canonical: "push" creates token file');
    assert(token && token.actions.includes('push'),
      'canonical: token includes push action');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 4. Canonical shape: combined commit + push + approve in one message
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      prompt: 'approve the gate, then commit and push',
      session_id: 's1',
      cwd: tmp,
    }, tmp);
    const token = readToken(tmp);
    assert(token !== null, 'canonical: combined keywords create token');
    assert(token && token.actions.includes('gate-approve'),
      'canonical: combined includes gate-approve');
    assert(token && token.actions.includes('commit'),
      'canonical: combined includes commit');
    assert(token && token.actions.includes('push'),
      'canonical: combined includes push');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 5. Canonical shape: negated "don't commit" → no commit token
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      prompt: "don't commit yet",
      session_id: 's1',
      cwd: tmp,
    }, tmp);
    const token = readToken(tmp);
    if (token) {
      assert(!token.actions.includes('commit'),
        'canonical: negated commit does NOT include commit action');
    } else {
      assert(true, 'canonical: negated commit creates no token');
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  // 6. Canonical shape: negated "don't approve" → no gate-approve token
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      prompt: "don't approve this",
      session_id: 's1',
      cwd: tmp,
    }, tmp);
    const token = readToken(tmp);
    if (token) {
      assert(!token.actions.includes('gate-approve'),
        'canonical: negated approve does NOT include gate-approve');
    } else {
      assert(true, 'canonical: negated approve creates no token');
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  // 7. Canonical shape: unrelated message → no token, deletes any existing
  {
    const tmp = makeTmpProject();
    writeApprovalToken(tmp, ['commit'], 120000);
    await runHook(APPROVAL_TOKEN_HOOK, {
      prompt: 'just checking the status',
      session_id: 's1',
      cwd: tmp,
    }, tmp);
    const token = readToken(tmp);
    assert(token === null, 'canonical: unrelated message deletes existing token (clean slate)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // ── Fallback payload shapes (legacy/test compatibility) ──────────────

  // 8. Fallback: message.content string shape
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      message: { content: '/forge:approve' },
    }, tmp);
    const token = readToken(tmp);
    assert(token !== null, 'fallback message.content: creates token');
    assert(token && token.actions.includes('gate-approve'),
      'fallback message.content: includes gate-approve');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 9. Fallback: message as plain string
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      message: 'commit and push',
    }, tmp);
    const token = readToken(tmp);
    assert(token !== null, 'fallback message string: creates token');
    assert(token && token.actions.includes('commit'),
      'fallback message string: includes commit');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 10. Fallback: user_prompt string
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      user_prompt: 'approve the plan',
    }, tmp);
    const token = readToken(tmp);
    assert(token !== null, 'fallback user_prompt: creates token');
    assert(token && token.actions.includes('gate-approve'),
      'fallback user_prompt: includes gate-approve');
    rmSync(tmp, { recursive: true, force: true });
  }

  // ── Malformed/edge case payloads ─────────────────────────────────────

  // 11. Empty prompt string → no token
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      prompt: '',
      session_id: 's1',
    }, tmp);
    const token = readToken(tmp);
    assert(token === null, 'empty prompt: no token created');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 12. No message fields at all → no token
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      session_id: 's1',
      cwd: tmp,
    }, tmp);
    const token = readToken(tmp);
    assert(token === null, 'no message fields: no token created');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 13. Malformed stdin → no token, no crash
  {
    const tmp = makeTmpProject();
    const child = spawn(process.execPath, [APPROVAL_TOKEN_HOOK], {
      cwd: tmp,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const result = await new Promise((resolve) => {
      child.stdin.write('not valid json {{{');
      child.stdin.end();
      child.on('close', code => resolve({ code }));
    });
    assert(result.code === 0, 'malformed stdin: exits 0 (no crash)');
    const token = readToken(tmp);
    assert(token === null, 'malformed stdin: no token created');
    rmSync(tmp, { recursive: true, force: true });
  }

  // ── workflow-guard.js Write tests ────────────────────────────────────

  // 14. Write gate-pending.json with approved + no token → blocked
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

  // 15. Write gate-pending.json with approved + valid token → allowed
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

  // 16. Write gate-pending.json with pending status + no token → allowed
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

  // 17. Edit gate-pending.json with "approved" + no token → blocked
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

  // 18. Edit gate-pending.json with "approved" + valid token → allowed
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

  // 19. Write to a different file → unaffected
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

  // 20. Expired token → blocked
  {
    const tmp = makeTmpProject();
    writeApprovalToken(tmp, ['gate-approve'], -1000);
    const content = JSON.stringify({ gate: 'gate2', status: 'approved', feature: 'test' });
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const { code } = await runHook(WORKFLOW_GUARD_HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 2, 'workflow-guard: Write approved + expired token → exit 2 (blocked)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 21. Token with commit/push but not gate-approve → blocked
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

  // 22. Bash tool call → unaffected
  {
    const tmp = makeTmpProject();
    const { code } = await runHook(WORKFLOW_GUARD_HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
    }, tmp);
    assert(code === 0, 'workflow-guard: Bash tool call → exit 0 (not Write/Edit)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // ── End-to-end: canonical payload → token → guard allows ─────────────

  // 23. Full round-trip: canonical approve payload → token minted → Write allowed
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      prompt: 'approve',
      session_id: 's1',
      cwd: tmp,
    }, tmp);
    const token = readToken(tmp);
    assert(token !== null, 'e2e: approve prompt mints token');
    const content = JSON.stringify({ gate: 'gate2', status: 'approved', feature: 'test' });
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const { code } = await runHook(WORKFLOW_GUARD_HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 0, 'e2e: Write approved succeeds after approve token minted');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 24. Full round-trip: canonical commit payload → token minted → token has commit
  {
    const tmp = makeTmpProject();
    await runHook(APPROVAL_TOKEN_HOOK, {
      prompt: 'commit the changes',
      session_id: 's1',
      cwd: tmp,
    }, tmp);
    const token = readToken(tmp);
    assert(token !== null, 'e2e: commit prompt mints token');
    assert(token && token.actions.includes('commit'),
      'e2e: minted token has commit action');
    assert(token && token.expiresAt,
      'e2e: minted token has expiresAt for TTL enforcement');
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log('');
  console.log('  ' + (passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(e => { console.error(e); process.exit(1); });
