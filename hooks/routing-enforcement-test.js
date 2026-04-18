#!/usr/bin/env node
'use strict';

// Test for hooks/routing-enforcement.js
// Run: node hooks/routing-enforcement-test.js

const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { spawn } = require('child_process');

const HOOK_PATH = join(__dirname, 'routing-enforcement.js');
const PLUGIN_ROOT = join(__dirname, '..');

const TTL_MS = 5 * 60 * 1000;

function runHook(payload, projectDir) {
  const cwd = projectDir || PLUGIN_ROOT;
  const fullPayload = projectDir ? { ...payload, cwd: projectDir } : payload;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      cwd,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.write(JSON.stringify(fullPayload));
    child.stdin.end();
    child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on('error', reject);
  });
}

function writeLog(projectDir, entries) {
  mkdirSync(join(projectDir, '.pipeline'), { recursive: true });
  writeFileSync(
    join(projectDir, '.pipeline', 'session-dispatch-log.json'),
    JSON.stringify({ entries }, null, 2),
    'utf8',
  );
}

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { console.log('  PASS  ' + label); passed++; }
  else       { console.error('  FAIL  ' + label); failed++; }
}

async function test() {
  console.log('\n── routing-enforcement-test.js ──────────────────────────────────────────');

  // 1. Pipeline agent + no log file → blocked
  {
    const tmp = mkdtempSync(join(tmpdir(), 're-test-'));
    mkdirSync(join(tmp, '.pipeline'), { recursive: true });
    const { code, stderr } = await runHook({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'coder' },
      session_id: 's1',
    }, tmp);
    assert(code === 2, 'pipeline agent + no log: exit code 2');
    assert(stderr.includes('coder') && stderr.includes('forge_get_model_recommendation'),
      'pipeline agent + no log: stderr explains the block with agent name');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 2. Pipeline agent + fresh matching log entry → allowed
  {
    const tmp = mkdtempSync(join(tmpdir(), 're-test-'));
    writeLog(tmp, [
      { agentName: 'coder', ts: Date.now() - 1000, modelId: 'claude-sonnet-4-6', providerId: 'anthropic' },
    ]);
    const { code } = await runHook({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'coder' },
      session_id: 's1',
    }, tmp);
    assert(code === 0, 'pipeline agent + fresh log entry: exit code 0 (allowed)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 3. Pipeline agent + expired log entry → blocked
  {
    const tmp = mkdtempSync(join(tmpdir(), 're-test-'));
    writeLog(tmp, [
      { agentName: 'coder', ts: Date.now() - (TTL_MS + 60_000), modelId: 'claude-sonnet-4-6', providerId: 'anthropic' },
    ]);
    const { code } = await runHook({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'coder' },
      session_id: 's1',
    }, tmp);
    assert(code === 2, 'pipeline agent + expired log entry: exit code 2 (blocked)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 4. Pipeline agent + log entry for a DIFFERENT agent → blocked
  {
    const tmp = mkdtempSync(join(tmpdir(), 're-test-'));
    writeLog(tmp, [
      { agentName: 'planner', ts: Date.now() - 1000, modelId: 'claude-sonnet-4-6', providerId: 'anthropic' },
    ]);
    const { code } = await runHook({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'coder' },
      session_id: 's1',
    }, tmp);
    assert(code === 2, 'pipeline agent + log entry for other agent: exit code 2 (blocked)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 5. Non-pipeline subagent type → allowed regardless of log
  {
    const tmp = mkdtempSync(join(tmpdir(), 're-test-'));
    // No log file at all
    const { code } = await runHook({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'general-purpose' },
      session_id: 's1',
    }, tmp);
    assert(code === 0, 'non-pipeline subagent type: exit code 0 (enforcement does not apply)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 6. Non-Agent tool call → allowed (unrelated tools unaffected)
  {
    const tmp = mkdtempSync(join(tmpdir(), 're-test-'));
    const { code } = await runHook({
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
      session_id: 's1',
    }, tmp);
    assert(code === 0, 'non-Agent tool call: exit code 0 (unaffected)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 7. Malformed log JSON → blocked (pipeline agent, treated as no entries)
  {
    const tmp = mkdtempSync(join(tmpdir(), 're-test-'));
    mkdirSync(join(tmp, '.pipeline'), { recursive: true });
    writeFileSync(join(tmp, '.pipeline', 'session-dispatch-log.json'), 'not valid json {', 'utf8');
    const { code } = await runHook({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'coder' },
      session_id: 's1',
    }, tmp);
    assert(code === 2, 'malformed log JSON: exit code 2 (fails closed)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 8. Agent tool with missing subagent_type → allowed (nothing to enforce against)
  {
    const tmp = mkdtempSync(join(tmpdir(), 're-test-'));
    const { code } = await runHook({
      tool_name: 'Agent',
      tool_input: {},
      session_id: 's1',
    }, tmp);
    assert(code === 0, 'Agent with no subagent_type: exit code 0');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 9. Multiple log entries for same agent — one fresh + one expired → allowed via fresh
  {
    const tmp = mkdtempSync(join(tmpdir(), 're-test-'));
    writeLog(tmp, [
      { agentName: 'reviewer-safety', ts: Date.now() - (TTL_MS + 60_000), modelId: 'claude-sonnet-4-6', providerId: 'anthropic' },
      { agentName: 'reviewer-safety', ts: Date.now() - 2000, modelId: 'claude-sonnet-4-6', providerId: 'anthropic' },
    ]);
    const { code } = await runHook({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'reviewer-safety' },
      session_id: 's1',
    }, tmp);
    assert(code === 0, 'mixed fresh+expired entries: exit 0 (fresh entry authorizes)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 10. Future-timestamp entry (clock skew / tampering) → blocked
  {
    const tmp = mkdtempSync(join(tmpdir(), 're-test-'));
    writeLog(tmp, [
      { agentName: 'coder', ts: Date.now() + 60_000, modelId: 'claude-sonnet-4-6', providerId: 'anthropic' },
    ]);
    const { code } = await runHook({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'coder' },
      session_id: 's1',
    }, tmp);
    assert(code === 2, 'future-timestamp entry: exit 2 (rejected as clock skew)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 11. Log with entries field missing / wrong shape → blocked for pipeline agent
  {
    const tmp = mkdtempSync(join(tmpdir(), 're-test-'));
    mkdirSync(join(tmp, '.pipeline'), { recursive: true });
    writeFileSync(
      join(tmp, '.pipeline', 'session-dispatch-log.json'),
      JSON.stringify({ somethingElse: true }),
      'utf8',
    );
    const { code } = await runHook({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'coder' },
      session_id: 's1',
    }, tmp);
    assert(code === 2, 'log without entries array: exit 2 (fails closed)');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 12. All 29 pipeline agents are detected as "pipeline agents" (regression check)
  {
    const tmp = mkdtempSync(join(tmpdir(), 're-test-'));
    mkdirSync(join(tmp, '.pipeline'), { recursive: true }); // no log file
    const pipelineAgents = [
      'agent-optimizer', 'architect', 'brainstormer', 'cleanup', 'coder',
      'coder-scout', 'completeness-checker', 'compound-refresh', 'debug',
      'documenter', 'gotcha-checker', 'ideator', 'implementation-architect',
      'implementer', 'implementer-triage', 'integrity-checker', 'planner',
      'refactor', 'regression-risk', 'researcher', 'researcher-triage',
      'reviewer-boundary', 'reviewer-logic', 'reviewer-performance',
      'reviewer-safety', 'reviewer-style', 'reviewer-triage', 'skills-generator',
      'tool-call-auditor',
    ];
    let blockedCount = 0;
    for (const agent of pipelineAgents) {
      const { code } = await runHook({
        tool_name: 'Agent',
        tool_input: { subagent_type: agent },
        session_id: 's1',
      }, tmp);
      if (code === 2) blockedCount++;
    }
    assert(blockedCount === pipelineAgents.length,
      'all 29 pipeline agents are enforced when no log present (blocked ' + blockedCount + '/' + pipelineAgents.length + ')');
    rmSync(tmp, { recursive: true, force: true });
  }

  // 13. supervisor is intentionally NOT enforced (runs via forge_call_external)
  {
    const tmp = mkdtempSync(join(tmpdir(), 're-test-'));
    mkdirSync(join(tmp, '.pipeline'), { recursive: true });
    const { code } = await runHook({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'supervisor' },
      session_id: 's1',
    }, tmp);
    assert(code === 0, 'supervisor: exit 0 (not enforced — uses forge_call_external path)');
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log('');
  console.log('  ' + (passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(e => { console.error(e); process.exit(1); });
