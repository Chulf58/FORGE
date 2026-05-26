// @covers hooks/agent-loop-guard.js
// AC-2: sidecar write on cap-fire
// Verifies that hooks/agent-loop-guard.js writes loop-guard-blocked.json
// BEFORE calling deny() when priorCount >= MAX_DISPATCHES_PER_AGENT_PER_RUN.

import { readFileSync, existsSync } from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '..', 'hooks', 'agent-loop-guard.js');
const TEST_NAME = 'loop-guard-sidecar';

function fail(msg) {
  process.stderr.write('[' + TEST_NAME + '] FAIL: ' + msg + '\n');
  process.exit(1);
}

function pass(msg) {
  process.stdout.write('[' + TEST_NAME + '] PASS: ' + msg + '\n');
}

// Source-level check: verify the sidecar write code path is present
const src = readFileSync(HOOK_PATH, 'utf8');

if (!src.includes('loop-guard-blocked.json')) {
  fail('hooks/agent-loop-guard.js does not reference loop-guard-blocked.json sidecar file');
}
if (!src.includes('sidecarPath') && !src.includes('sidecar')) {
  fail('hooks/agent-loop-guard.js does not contain sidecar write logic');
}

// Integration test: invoke the hook with priorCount >= 25 (the current cap,
// MAX_DISPATCHES_PER_AGENT_PER_RUN in hooks/agent-loop-guard.js) via childProcess
// and verify the sidecar file is written before deny fires.

async function runIntegrationTest() {
  const runId = 'r-' + randomBytes(4).toString('hex');
  const projectDir = join(tmpdir(), 'forge-sidecar-test-' + randomBytes(4).toString('hex'));
  const countsDir = join(projectDir, '.pipeline', 'run-agent-counts');
  const runsDir = join(projectDir, '.pipeline', 'runs', runId);
  const sidecarPath = join(runsDir, 'loop-guard-blocked.json');

  // Setup: create countsDir + runDir, write count file at the cap (25 dispatches)
  await fsPromises.mkdir(countsDir, { recursive: true });
  await fsPromises.mkdir(runsDir, { recursive: true });
  await fsPromises.writeFile(
    join(countsDir, runId + '.json'),
    JSON.stringify({ coder: 25 }),
    'utf8',
  );

  // Build a minimal hook payload
  const payload = {
    tool_name: 'Agent',
    run_id: runId,
    tool_input: { subagent_type: 'coder' },
    // env used by resolveProjectDir — pass via process.env-style injection
    cwd: projectDir,
  };

  const payloadStr = JSON.stringify(payload);

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      env: {
        ...process.env,
        CLAUDE_PLUGIN_DATA: projectDir,
        // Some resolveProjectDir implementations use cwd
      },
      cwd: projectDir,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.stdin.write(payloadStr + '\n');
    child.stdin.end();

    child.on('close', (code) => {
      // Hook should exit 2 (deny) when cap is hit
      if (code !== 2) {
        fail('expected exit code 2 (deny) but got ' + code + '; stderr: ' + stderr);
        return;
      }

      // After deny, sidecar should exist
      if (!existsSync(sidecarPath)) {
        fail('sidecar file not written at ' + sidecarPath + '; hook exited ' + code);
        return;
      }

      let sidecar;
      try {
        sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
      } catch (e) {
        fail('sidecar file is not valid JSON: ' + e.message);
        return;
      }

      if (!sidecar.agentType) fail('sidecar missing agentType field');
      if (!sidecar.blockedAt) fail('sidecar missing blockedAt field');
      if (typeof sidecar.dispatchCount !== 'number') fail('sidecar missing numeric dispatchCount field');
      if (!sidecar.runId) fail('sidecar missing runId field');
      if (sidecar.agentType !== 'coder') fail('sidecar agentType should be coder, got: ' + sidecar.agentType);
      if (sidecar.runId !== runId) fail('sidecar runId mismatch: ' + sidecar.runId + ' vs ' + runId);

      pass('sidecar written with correct fields on cap-fire');
      resolve();
    });
  });
}

runIntegrationTest().then(() => {
  process.exit(0);
}).catch(e => {
  fail('unexpected error: ' + e.message);
});
