'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, 'gate-enforcement.js');

let pass = 0;
let fail = 0;

function assert(label, actual, expected) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL  ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(label, text, substr) {
  if (text.includes(substr)) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL  ${label}\n    expected to include: ${JSON.stringify(substr)}\n    actual: ${JSON.stringify(text.slice(0, 300))}`);
  }
}

function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-enf-'));
  fs.mkdirSync(path.join(dir, '.pipeline', 'runs', 'r-test1'), { recursive: true });
  return dir;
}

function writeRunActive(dir, data) {
  fs.writeFileSync(path.join(dir, '.pipeline', 'run-active.json'), JSON.stringify(data), 'utf8');
}

function writeRunRecord(dir, runId, data) {
  const runDir = path.join(dir, '.pipeline', 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(data), 'utf8');
}

function writeGatePending(dir, data) {
  fs.writeFileSync(path.join(dir, '.pipeline', 'gate-pending.json'), JSON.stringify(data), 'utf8');
}

function runHook(dir, payload) {
  const input = JSON.stringify(payload);
  try {
    const stdout = execSync(`node "${HOOK}"`, {
      input,
      cwd: dir,
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

function coderPayload() {
  return { tool_name: 'Agent', tool_input: { subagent_type: 'forge:coder' } };
}

function implementerPayload() {
  return { tool_name: 'Agent', tool_input: { subagent_type: 'forge:implementer' } };
}

console.log('\n── gate-enforcement-test.js ──────────────────────────────────────────');

// --- Test 1: SPRINT in run-active.json with matching run record → bypass allowed ---
{
  const dir = makeTmp();
  writeRunActive(dir, { runId: 'r-test1', mode: 'SPRINT', pipelineType: 'implement' });
  writeRunRecord(dir, 'r-test1', { mode: 'SPRINT', pipelineType: 'implement', status: 'running' });
  const r = runHook(dir, coderPayload());
  assert('SPRINT+implement with matching record: exit 0 (bypass allowed)', r.exitCode, 0);
}

// --- Test 2: Tampered run-active.json claims SPRINT but run record says STANDARD ---
{
  const dir = makeTmp();
  writeRunActive(dir, { runId: 'r-test1', mode: 'SPRINT', pipelineType: 'implement' });
  writeRunRecord(dir, 'r-test1', { mode: 'STANDARD', pipelineType: 'implement', status: 'running' });
  const r = runHook(dir, coderPayload());
  assert('tampered SPRINT vs STANDARD run record: exit 2 (cross-ref catches it)', r.exitCode, 2);
}

// --- Test 3: LEAN mode → no bypass, normal gate enforcement ---
{
  const dir = makeTmp();
  writeRunActive(dir, { runId: 'r-test1', mode: 'LEAN', pipelineType: 'implement' });
  writeRunRecord(dir, 'r-test1', { mode: 'LEAN', pipelineType: 'implement', status: 'running' });
  const r = runHook(dir, coderPayload());
  assert('LEAN mode: exit 2 (gates enforced, no gate-pending)', r.exitCode, 2);
}

// --- Test 4: LEAN mode with approved gate → allowed ---
{
  const dir = makeTmp();
  writeRunActive(dir, { runId: 'r-test1', mode: 'LEAN', pipelineType: 'implement' });
  writeRunRecord(dir, 'r-test1', { mode: 'LEAN', pipelineType: 'implement', status: 'running' });
  writeGatePending(dir, { gate: 'gate1', status: 'approved', feature: 'test' });
  const r = runHook(dir, coderPayload());
  assert('LEAN + gate1 approved: exit 0 (allowed)', r.exitCode, 0);
}

// --- Test 5: Tampered runId with path traversal → fail closed ---
{
  const dir = makeTmp();
  writeRunActive(dir, { runId: '../../../etc', mode: 'SPRINT', pipelineType: 'plan' });
  const r = runHook(dir, coderPayload());
  assert('path-traversal runId: exit 2 (fail closed)', r.exitCode, 2);
}

// --- Test 6: Non-Agent tool call → exit 0 (unaffected) ---
{
  const dir = makeTmp();
  const r = runHook(dir, { tool_name: 'Write', tool_input: {} });
  assert('non-Agent tool: exit 0 (unaffected)', r.exitCode, 0);
}

// --- Test 7: SPRINT + plan with matching record → bypass allowed ---
{
  const dir = makeTmp();
  writeRunActive(dir, { runId: 'r-test1', mode: 'SPRINT', pipelineType: 'plan' });
  writeRunRecord(dir, 'r-test1', { mode: 'SPRINT', pipelineType: 'plan', status: 'running' });
  const r = runHook(dir, coderPayload());
  assert('SPRINT+plan: exit 0 (bypass allowed)', r.exitCode, 0);
}

// --- Test 8: SPRINT claimed but no run record → fail closed ---
{
  const dir = makeTmp();
  writeRunActive(dir, { runId: 'r-noexist', mode: 'SPRINT', pipelineType: 'implement' });
  const r = runHook(dir, coderPayload());
  assert('SPRINT but no run record: exit 2 (fail closed)', r.exitCode, 2);
}

// --- Test 9: SPRINT + apply with matching record → bypass allowed ---
{
  const dir = makeTmp();
  writeRunActive(dir, { runId: 'r-test1', mode: 'SPRINT', pipelineType: 'apply' });
  writeRunRecord(dir, 'r-test1', { mode: 'SPRINT', pipelineType: 'apply', status: 'running' });
  const r = runHook(dir, implementerPayload());
  assert('SPRINT+apply: exit 0 (bypass allowed)', r.exitCode, 0);
}

// --- Summary ---
console.log(`\n  ${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
