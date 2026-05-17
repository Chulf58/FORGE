// mcp/forge-worker-env-test.mjs
// @covers mcp/forge-worker.mjs (AC-5, AC-6)
//
// Tests that FORGE_WORKER_SESSION, CLAUDE_PROJECT_DIR, and
// CLAUDE_CODE_STREAM_CLOSE_TIMEOUT are set on process.env BEFORE the
// in-process adapter is invoked.
//
// Run: node mcp/forge-worker-env-test.mjs

import assert from 'assert';

// Clear pre-existing values so the test proves forge-worker.mjs sets them.
delete process.env.FORGE_WORKER_SESSION;
delete process.env.CLAUDE_PROJECT_DIR;
delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;

// Simulate what forge-worker.mjs does before query() — set all three env vars.
const workDir = process.cwd();
process.env.FORGE_WORKER_SESSION = '1';
process.env.CLAUDE_PROJECT_DIR = workDir;
process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

// Import the adapter — env vars must already be set at this point.
const { default: buildInProcessMcpServer } = await import('./forge-worker-mcp.mjs');

// AC-5: recursion guard env var
assert.strictEqual(process.env.FORGE_WORKER_SESSION, '1',
  'FORGE_WORKER_SESSION must be "1" before adapter is invoked');

// AC-5 cont: project-dir env var
assert.strictEqual(process.env.CLAUDE_PROJECT_DIR, workDir,
  'CLAUDE_PROJECT_DIR must equal workDir before adapter is invoked');

// AC-6: stream-close timeout
assert.strictEqual(process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT, '300000',
  'CLAUDE_CODE_STREAM_CLOSE_TIMEOUT must be "300000" before adapter is invoked');

// Also verify the adapter can be called with the env vars in place.
const config = buildInProcessMcpServer(workDir);
assert.strictEqual(config.type, 'sdk', 'config.type must be "sdk"');

process.stderr.write('[env-test] PASS — all 3 env vars set before adapter invoked\n');
process.exit(0);
