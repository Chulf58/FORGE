'use strict';
// Smoke tests for [CONTEXT-CHECKPOINT] detection in subagent-stop.js.
// Verifies the three detection cases:
//   (a) signal + checkpoint.md exists → outcome "checkpoint"
//   (b) signal + checkpoint.md missing → outcome "completed" (orphan signal warning)
//   (c) no signal → outcome unchanged (still "completed")
//
// Run: node hooks/checkpoint-detection-test.js

const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { spawn } = require('child_process');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { failed++; console.error('  FAIL  ' + msg); }
  else { passed++; console.log('  PASS  ' + msg); }
}

function runHook(payload, projectDir) {
  const fullPayload = { ...payload, cwd: projectDir };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, 'subagent-stop.js')], {
      cwd: projectDir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: join(__dirname, '..') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.write(JSON.stringify(fullPayload));
    child.stdin.end();
    child.on('close', code => resolve({ code, stderr: stderr.trim() }));
    child.on('error', reject);
  });
}

// makeProject: sets up the per-run directory structure that findActiveRun expects.
// findActiveRun scans .pipeline/runs/<runId>/run.json for non-terminal status,
// then subagent-stop.js reads .pipeline/runs/<runId>/run-active.json.
// The legacy .pipeline/run-active.json flat path is NOT used by the current hook.
function makeProject(tmp, agentId, agentType) {
  const runId = 'r-test';
  const runDir = join(tmp, '.pipeline', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({
    runId, status: 'running', feature: 'test', pipelineType: 'debug',
  }));
  writeFileSync(join(runDir, 'run-active.json'), JSON.stringify({
    runId, startedAt: Date.now(), pipelineType: 'debug',
    feature: 'test', agents: [
      { agent_id: agentId, agent_type: agentType, startedAt: Date.now() },
    ], currentUnit: { agent: agentType, startedAt: Date.now() },
  }));
}

// Use 'coder' as the agent type for all 3 tests.
// Rationale: coder's truncation check (subagent-stop.js line 234) is guarded by
// data.worktreePath — absent in test payloads — so outcome stays "completed"
// in the non-checkpoint cases without needing stub handoff.md files.
const CHECKPOINT_SIGNAL_MSG = 'Partial output before context limit.\n[CONTEXT-CHECKPOINT]';
const CLEAN_MSG = 'Normal coder output with no signals.';

console.log('\n── checkpoint-detection-test.js ─────────────────────────────────────────');

async function test() {
  // Test 1 (case a): signal emitted AND checkpoint.md exists → outcome "checkpoint"
  {
    const tmp = mkdtempSync(join(tmpdir(), 'cp-test-'));
    makeProject(tmp, 'agent-coder-cp-1', 'coder');
    mkdirSync(join(tmp, 'docs', 'context'), { recursive: true });
    writeFileSync(join(tmp, 'docs', 'context', 'checkpoint.md'), '# Checkpoint\nPartial work completed so far.');
    const { stderr } = await runHook({
      tool_name: 'agent_stop',
      agent_id: 'agent-coder-cp-1',
      agent_type: 'coder',
      last_assistant_message: CHECKPOINT_SIGNAL_MSG,
      session_id: 'test',
    }, tmp);
    const data = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', 'r-test', 'run-active.json'), 'utf8'));
    const entry = data.agents.find(a => a.agent_id === 'agent-coder-cp-1');
    assert(entry && entry.outcome === 'checkpoint',
      'coder emits [CONTEXT-CHECKPOINT] + checkpoint.md exists: outcome is "checkpoint"');
    assert(stderr.includes('stamping outcome: checkpoint'),
      'coder checkpoint: stderr confirms "stamping outcome: checkpoint"');
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 2 (case b): signal emitted BUT checkpoint.md is missing → outcome "completed" (orphan)
  {
    const tmp = mkdtempSync(join(tmpdir(), 'cp-test-'));
    makeProject(tmp, 'agent-coder-cp-2', 'coder');
    // docs/context/ exists but checkpoint.md does NOT
    mkdirSync(join(tmp, 'docs', 'context'), { recursive: true });
    const { stderr } = await runHook({
      tool_name: 'agent_stop',
      agent_id: 'agent-coder-cp-2',
      agent_type: 'coder',
      last_assistant_message: CHECKPOINT_SIGNAL_MSG,
      session_id: 'test',
    }, tmp);
    const data = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', 'r-test', 'run-active.json'), 'utf8'));
    const entry = data.agents.find(a => a.agent_id === 'agent-coder-cp-2');
    assert(entry && entry.outcome === 'completed',
      'coder emits [CONTEXT-CHECKPOINT] but checkpoint.md missing: outcome is "completed" (orphan)');
    assert(stderr.includes('checkpoint.md not found'),
      'orphan signal: stderr warns about missing checkpoint.md');
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 3 (case c): no signal emitted → outcome "completed" (checkpoint logic not triggered)
  {
    const tmp = mkdtempSync(join(tmpdir(), 'cp-test-'));
    makeProject(tmp, 'agent-coder-cp-3', 'coder');
    await runHook({
      tool_name: 'agent_stop',
      agent_id: 'agent-coder-cp-3',
      agent_type: 'coder',
      last_assistant_message: CLEAN_MSG,
      session_id: 'test',
    }, tmp);
    const data = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', 'r-test', 'run-active.json'), 'utf8'));
    const entry = data.agents.find(a => a.agent_id === 'agent-coder-cp-3');
    assert(entry && entry.outcome === 'completed',
      'coder with no signal: outcome is "completed"');
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log('');
  console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(e => { console.error(e); process.exit(1); });
