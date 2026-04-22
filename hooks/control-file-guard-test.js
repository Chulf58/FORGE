#!/usr/bin/env node
'use strict';

// Tests for control-file write guards in workflow-guard.js:
//   - .pipeline/run-active.json: ALL direct Write/Edit blocked
//   - .pipeline/gate-pending.json: only pending writes or token-authorized writes allowed
//   - Other .pipeline/ files: unaffected
//
// Run: node hooks/control-file-guard-test.js

const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { spawn } = require('child_process');

const WORKFLOW_GUARD_HOOK = join(__dirname, 'workflow-guard.js');
const PLUGIN_ROOT = join(__dirname, '..');

function runHook(payload, projectDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKFLOW_GUARD_HOOK], {
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

function makeTmp() {
  const tmp = mkdtempSync(join(tmpdir(), 'ctrl-guard-'));
  mkdirSync(join(tmp, '.pipeline'), { recursive: true });
  return tmp;
}

function writeApprovalToken(dir, actions, ttlMs) {
  writeFileSync(
    join(dir, '.pipeline', 'action-approved.json'),
    JSON.stringify({
      actions,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (ttlMs || 120000)).toISOString(),
      source: 'test',
    }, null, 2) + '\n',
    'utf8',
  );
}

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; }
  else { console.error('  FAIL  ' + label); failed++; }
}

async function test() {
  console.log('\n── control-file-guard-test.js ───────────────────────────────────────');

  // --- run-active.json: ALL writes blocked ---

  // 1. Write to run-active.json → blocked
  {
    const tmp = makeTmp();
    const filePath = join(tmp, '.pipeline', 'run-active.json');
    const content = JSON.stringify({ runId: 'r-test', mode: 'LEAN', pipelineType: 'plan' });
    const { code, stdout } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 2, 'Write run-active.json → exit 2');
    assert(stdout.includes('run-active.json'), 'Write run-active.json → mentions file');
    assert(stdout.includes('forge_create_run') || stdout.includes('forge_resume_run'),
      'Write run-active.json → suggests MCP tools');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 2. Edit to run-active.json → blocked
  {
    const tmp = makeTmp();
    const filePath = join(tmp, '.pipeline', 'run-active.json');
    const { code } = await runHook({
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: '"LEAN"', new_string: '"SPRINT"' },
    }, tmp);
    assert(code === 2, 'Edit run-active.json → exit 2');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 3. Write run-active.json with approval token → still blocked (no token exemption)
  {
    const tmp = makeTmp();
    writeApprovalToken(tmp, ['gate-approve', 'commit', 'push'], 120000);
    const filePath = join(tmp, '.pipeline', 'run-active.json');
    const content = JSON.stringify({ runId: 'r-test', mode: 'LEAN' });
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 2, 'Write run-active.json + token → still exit 2 (unconditional)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // --- gate-pending.json: structural guard ---

  // 4. Write gate-pending.json with pending status → allowed (skill path)
  {
    const tmp = makeTmp();
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const content = JSON.stringify({ gate: 'gate1', status: 'pending', feature: 'test feature' });
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 0, 'Write gate-pending pending → exit 0 (skill path)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 5. Write gate-pending.json with approved + no token → blocked
  {
    const tmp = makeTmp();
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const content = JSON.stringify({ gate: 'gate2', status: 'approved', feature: 'test' });
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 2, 'Write gate-pending approved + no token → exit 2');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 6. Write gate-pending.json with approved + valid token → allowed
  {
    const tmp = makeTmp();
    writeApprovalToken(tmp, ['gate-approve'], 120000);
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const content = JSON.stringify({ gate: 'gate2', status: 'approved', feature: 'test' });
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 0, 'Write gate-pending approved + token → exit 0');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 7. Write gate-pending.json with garbage status + no token → blocked
  {
    const tmp = makeTmp();
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const content = JSON.stringify({ gate: 'gate1', status: 'corrupted', feature: 'hack' });
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 2, 'Write gate-pending garbage status + no token → exit 2');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 8. Write gate-pending.json with garbage status + valid token → allowed
  {
    const tmp = makeTmp();
    writeApprovalToken(tmp, ['gate-approve'], 120000);
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const content = JSON.stringify({ status: 'whatever' });
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 0, 'Write gate-pending garbage + token → exit 0 (token overrides)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 9. Edit gate-pending.json + no token → blocked (Edit never treated as pending-write)
  {
    const tmp = makeTmp();
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const { code } = await runHook({
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: '"gate1"', new_string: '"gate2"' },
    }, tmp);
    assert(code === 2, 'Edit gate-pending + no token → exit 2');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 10. Edit gate-pending.json + valid token → allowed
  {
    const tmp = makeTmp();
    writeApprovalToken(tmp, ['gate-approve'], 120000);
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const { code } = await runHook({
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: '"pending"', new_string: '"approved"' },
    }, tmp);
    assert(code === 0, 'Edit gate-pending + token → exit 0');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 11. Write gate-pending.json with invalid JSON + no token → blocked
  {
    const tmp = makeTmp();
    const filePath = join(tmp, '.pipeline', 'gate-pending.json');
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: 'not json {{{' },
    }, tmp);
    assert(code === 2, 'Write gate-pending invalid JSON + no token → exit 2');
    rmSync(tmp, { recursive: true, force: true });
  }

  // --- action-approved.json: ALL writes blocked ---

  // 12. Write to action-approved.json → blocked
  {
    const tmp = makeTmp();
    const filePath = join(tmp, '.pipeline', 'action-approved.json');
    const content = JSON.stringify({ actions: ['commit'], expiresAt: new Date(Date.now() + 120000).toISOString() });
    const { code, stdout } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 2, 'Write action-approved.json → exit 2');
    assert(stdout.includes('action-approved.json'), 'Write action-approved.json → mentions file');
    assert(stdout.includes('UserPromptSubmit'), 'Write action-approved.json → points to correct hook');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 13. Edit to action-approved.json → blocked
  {
    const tmp = makeTmp();
    const filePath = join(tmp, '.pipeline', 'action-approved.json');
    const { code } = await runHook({
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: '"commit"', new_string: '"gate-approve"' },
    }, tmp);
    assert(code === 2, 'Edit action-approved.json → exit 2');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 14. Write action-approved.json with gate-approve token → still blocked (unconditional)
  {
    const tmp = makeTmp();
    writeApprovalToken(tmp, ['gate-approve'], 120000);
    const filePath = join(tmp, '.pipeline', 'action-approved.json');
    const content = JSON.stringify({ actions: ['gate-approve', 'commit'], expiresAt: new Date(Date.now() + 120000).toISOString() });
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
    }, tmp);
    assert(code === 2, 'Write action-approved.json + existing token → still exit 2 (unconditional)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // --- Other .pipeline/ files: unaffected ---

  // 15. Write to .pipeline/board.json → unaffected
  {
    const tmp = makeTmp();
    const filePath = join(tmp, '.pipeline', 'board.json');
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: '{}' },
    }, tmp);
    assert(code === 0, 'Write board.json → exit 0 (unaffected)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 16. Write to .pipeline/project.json → unaffected
  {
    const tmp = makeTmp();
    const filePath = join(tmp, '.pipeline', 'project.json');
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: '{}' },
    }, tmp);
    assert(code === 0, 'Write project.json → exit 0 (unaffected)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 17. Write to .pipeline/modules.json → unaffected
  {
    const tmp = makeTmp();
    const filePath = join(tmp, '.pipeline', 'modules.json');
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: '{}' },
    }, tmp);
    assert(code === 0, 'Write modules.json → exit 0 (unaffected)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 18. Non-Write/Edit tool → unaffected
  {
    const tmp = makeTmp();
    const { code } = await runHook({
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
    }, tmp);
    assert(code === 0, 'Bash tool → exit 0 (not Write/Edit)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 19. Write to regular file outside .pipeline/ → unaffected
  {
    const tmp = makeTmp();
    const filePath = join(tmp, 'src', 'index.js');
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: 'console.log("hello")' },
    }, tmp);
    assert(code === 0, 'Write regular file → exit 0 (unaffected)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 20. Windows-style backslash path to run-active.json → still blocked
  {
    const tmp = makeTmp();
    const filePath = join(tmp, '.pipeline', 'run-active.json'); // join uses OS separator
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: '{}' },
    }, tmp);
    assert(code === 2, 'Write run-active.json (OS path) → exit 2');
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log('');
  console.log('  ' + (passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(e => { console.error(e); process.exit(1); });
