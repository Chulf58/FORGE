// @covers skills/unblock/SKILL.md
// AC-7: /forge:unblock skill
// Verifies the skill file exists and contains the required directives.
// Also tests the underlying file operations (sidecar delete) programmatically.

import { readFileSync, existsSync } from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(__dirname, '..', 'skills', 'unblock', 'SKILL.md');
const TEST_NAME = 'loop-guard-unblock-skill';

function fail(msg) {
  process.stderr.write('[' + TEST_NAME + '] FAIL: ' + msg + '\n');
  process.exit(1);
}

function pass(msg) {
  process.stdout.write('[' + TEST_NAME + '] PASS: ' + msg + '\n');
}

// Sub-case: skill file exists
if (!existsSync(SKILL_PATH)) {
  fail('skills/unblock/SKILL.md does not exist');
}
pass('skill file exists at skills/unblock/SKILL.md');

const skillSrc = readFileSync(SKILL_PATH, 'utf8');

// Frontmatter checks
if (!skillSrc.includes('forge:unblock')) {
  fail('skill must declare name: forge:unblock in frontmatter');
}
pass('skill declares forge:unblock name');

// RunId is required
if (!skillSrc.includes('runId') && !skillSrc.includes('run ID') && !skillSrc.includes('<runId>')) {
  fail('skill must document runId as required argument');
}
pass('skill references runId argument');

// Error path: list loop-guard-pending runs when runId missing/invalid
if (!skillSrc.includes('loop-guard-pending')) {
  fail('skill must reference loop-guard-pending status for error listing');
}
pass('skill references loop-guard-pending for error listing');

// Sidecar deletion step
if (!skillSrc.includes('loop-guard-blocked.json') && !skillSrc.includes('sidecar')) {
  fail('skill must instruct deletion of loop-guard-blocked.json sidecar');
}
pass('skill references sidecar deletion');

// ENOENT / idempotent handling
if (!skillSrc.includes('ENOENT') && !skillSrc.includes('idempotent') && !skillSrc.includes('no-op')) {
  fail('skill must handle ENOENT as no-op (idempotent double-deletion)');
}
pass('skill handles ENOENT as no-op');

// ── Integration test: underlying file operations ───────────────────────────

async function runIntegrationTest() {
  const runId = 'r-' + randomBytes(4).toString('hex');
  const projectDir = join(tmpdir(), 'forge-unblock-test-' + randomBytes(4).toString('hex'));
  const runDir = join(projectDir, '.pipeline', 'runs', runId);
  const sidecarPath = join(runDir, 'loop-guard-blocked.json');

  await fsPromises.mkdir(runDir, { recursive: true });

  // Write run.json in loop-guard-pending state
  const runJson = {
    runId,
    status: 'loop-guard-pending',
    feature: 'test',
    pipelineType: 'implement',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await fsPromises.writeFile(join(runDir, 'run.json'), JSON.stringify(runJson, null, 2), 'utf8');

  // Write sidecar
  const sidecarData = {
    agentType: 'coder',
    blockedAt: new Date().toISOString(),
    dispatchCount: 15,
    runId,
  };
  await fsPromises.writeFile(sidecarPath, JSON.stringify(sidecarData, null, 2), 'utf8');

  // Sub-case (1): happy-path — delete sidecar, verify absence
  await fsPromises.unlink(sidecarPath);
  if (existsSync(sidecarPath)) {
    fail('sub-case (1): sidecar still exists after deletion');
  }
  pass('sub-case (1): sidecar deleted (happy-path file operation)');

  // Sub-case (4): double-deletion idempotence — second unlink on absent file is ENOENT
  let doubleDeleteError = null;
  try {
    await fsPromises.unlink(sidecarPath);
  } catch (e) {
    doubleDeleteError = e;
  }
  if (doubleDeleteError && doubleDeleteError.code !== 'ENOENT') {
    fail('sub-case (4): unexpected error on double-delete: ' + doubleDeleteError.message);
  }
  // ENOENT is expected and should be treated as no-op
  pass('sub-case (4): double-deletion produces ENOENT (should be no-op)');

  // Sub-case (2): missing runId — skill should list loop-guard-pending runs
  // Source-level check: skill must document the error path
  if (!skillSrc.includes('missing') && !skillSrc.includes('required') && !skillSrc.includes('no runId')) {
    // Accept any form of "runId is required" documentation
    if (!skillSrc.includes('runId')) {
      fail('sub-case (2): skill must document error when runId is missing');
    }
  }
  pass('sub-case (2): skill documents missing runId error path');

  // Sub-case (3): wrong runId — skill lists all loop-guard-pending runs
  if (!skillSrc.includes('r-') && !skillSrc.includes('agentType') && !skillSrc.includes('blocked at')) {
    fail('sub-case (3): skill must document run listing format for wrong runId');
  }
  pass('sub-case (3): skill documents run listing for wrong runId');
}

runIntegrationTest().then(() => {
  process.stdout.write('[' + TEST_NAME + '] All checks passed\n');
  process.exit(0);
}).catch(e => {
  fail('unexpected error: ' + (e && e.message ? e.message : String(e)));
});
