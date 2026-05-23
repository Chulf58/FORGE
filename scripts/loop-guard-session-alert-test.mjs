// @covers hooks/ctx-session-start.js
// AC-6: ctx-session-start emitLoopGuardAlertIfAny
// Tests that emitLoopGuardAlertIfAny writes the correct alert to stderr
// when a run has a loop-guard sidecar present.

import { promises as fsPromises } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '..', 'hooks', 'ctx-session-start.js');
const TEST_NAME = 'loop-guard-session-alert';

function fail(msg) {
  process.stderr.write('[' + TEST_NAME + '] FAIL: ' + msg + '\n');
  process.exit(1);
}

function pass(msg) {
  process.stdout.write('[' + TEST_NAME + '] PASS: ' + msg + '\n');
}

// Source-level check: emitLoopGuardAlertIfAny must be exported
const { readFileSync } = await import('node:fs');
const src = readFileSync(HOOK_PATH, 'utf8');
if (!src.includes('emitLoopGuardAlertIfAny')) {
  fail('ctx-session-start.js must export emitLoopGuardAlertIfAny');
}
if (!src.includes('module.exports') || !src.includes('emitLoopGuardAlertIfAny')) {
  fail('emitLoopGuardAlertIfAny must be in module.exports');
}
pass('emitLoopGuardAlertIfAny export present in source');

// Integration test: import and call emitLoopGuardAlertIfAny with a temp project dir
async function runIntegrationTest() {
  const runId = 'r-' + randomBytes(4).toString('hex');
  const projectDir = join(tmpdir(), 'forge-session-alert-test-' + randomBytes(4).toString('hex'));
  const runDir = join(projectDir, '.pipeline', 'runs', runId);
  const sidecarPath = join(runDir, 'loop-guard-blocked.json');

  await fsPromises.mkdir(runDir, { recursive: true });

  const agentType = 'coder';
  const dispatchCount = 15;
  const blockedAt = new Date().toISOString();
  const sidecarData = { agentType, blockedAt, dispatchCount, runId };

  await fsPromises.writeFile(sidecarPath, JSON.stringify(sidecarData, null, 2), 'utf8');

  // Capture stderr output
  const stderrChunks = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };

  const require = createRequire(import.meta.url);
  const hookModule = require(HOOK_PATH);

  if (typeof hookModule.emitLoopGuardAlertIfAny !== 'function') {
    process.stderr.write = origWrite;
    fail('emitLoopGuardAlertIfAny is not a function in module exports');
  }

  try {
    await hookModule.emitLoopGuardAlertIfAny(projectDir);
  } finally {
    process.stderr.write = origWrite;
  }

  const stderrOutput = stderrChunks.join('');

  if (!stderrOutput.includes(runId)) {
    fail('alert must contain runId "' + runId + '", got: ' + stderrOutput);
  }
  if (!stderrOutput.includes(agentType)) {
    fail('alert must contain agentType "' + agentType + '", got: ' + stderrOutput);
  }
  if (!stderrOutput.includes(String(dispatchCount))) {
    fail('alert must contain dispatchCount ' + dispatchCount + ', got: ' + stderrOutput);
  }
  if (!stderrOutput.includes('/forge:unblock')) {
    fail('alert must contain /forge:unblock instruction, got: ' + stderrOutput);
  }
  pass('alert emitted with runId + agentType + dispatchCount + /forge:unblock');
}

runIntegrationTest().then(() => {
  process.stdout.write('[' + TEST_NAME + '] All checks passed\n');
  process.exit(0);
}).catch(e => {
  fail('unexpected error: ' + (e && e.message ? e.message : String(e)));
});
