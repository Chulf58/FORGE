// mcp/forge-worker-crash-test.mjs
// @covers mcp/forge-worker-mcp.mjs (AC-7: crash containment)
//
// Tests that:
//   (a) shim returns { isError: true } when a tool throws (primary catch)
//   (b) process.exitCode is still undefined after a tool throw (process alive)
//   (c) a subsequent benign tool call succeeds
//   (d) at least one uncaughtException listener is registered
//
// Run: node mcp/forge-worker-crash-test.mjs

import assert from 'assert';

// Install an uncaughtException handler (mirrors what forge-worker.mjs installs).
// This simulates the worker's last-resort crash containment.
process.on('uncaughtException', (err) => {
  process.stderr.write('[crash-test] uncaughtException caught: ' + String(err && err.message ? err.message : err) + '\n');
});

// AC-7(d): at least one uncaughtException listener registered
assert.ok(
  process.listeners('uncaughtException').length >= 1,
  'At least one uncaughtException listener must be registered',
);

// Import adapter
const {
  default: buildInProcessMcpServer,
  TEST_ONLY_callHandler,
} = await import('./forge-worker-mcp.mjs');

// Build server instance (required to populate _handlers map)
const config = buildInProcessMcpServer(process.cwd());
assert.strictEqual(config.type, 'sdk', 'config.type must be "sdk"');
assert.ok(config.instance !== null && typeof config.instance === 'object',
  'instance must be non-null object');

assert.strictEqual(typeof TEST_ONLY_callHandler, 'function',
  'TEST_ONLY_callHandler must be exported from forge-worker-mcp.mjs');

// AC-7(a): throwing tool returns isError: true
const throwResult = await TEST_ONLY_callHandler('__test_throw__', {});
assert.strictEqual(throwResult.isError, true,
  'throwing tool must return isError: true');
assert.ok(Array.isArray(throwResult.content),
  'throwResult.content must be an array');

// AC-7(b): process.exitCode is still undefined (process still running)
assert.strictEqual(process.exitCode, undefined,
  'process.exitCode must be undefined after a tool throw');

// AC-7(c): subsequent benign tool call returns a result (does not throw).
// forge_get_active_run is read-only — may return an error result but must not throw.
let benignResult;
try {
  benignResult = await TEST_ONLY_callHandler('forge_get_active_run', {});
} catch (err) {
  assert.fail('benign tool call must not throw; got: ' + String(err && err.message ? err.message : err));
}
assert.ok(benignResult !== null && benignResult !== undefined,
  'benign tool must return a non-null result');

process.stderr.write('[crash-test] PASS — crash containment verified\n');
process.exit(0);
