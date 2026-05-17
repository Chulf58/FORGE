// mcp/forge-worker-inprocess-test.mjs
// @covers mcp/forge-worker-mcp.mjs
//
// AC-3: all 38 forge_* tools registered by the in-process adapter.
// AC-8: per-tool { tool, durationMs } structured log emitted to stderr.
//
// Run: node mcp/forge-worker-inprocess-test.mjs

import assert from 'assert';

// Expected tool names — must match mcp/server-registration-test.mjs exactly.
const EXPECTED_TOOLS = [
  // board.js (9)
  'forge_read_board', 'forge_add_todo', 'forge_update_task', 'forge_add_note',
  'forge_read_notes', 'forge_delete_note', 'forge_read_project', 'forge_update_config',
  'forge_set_blocked_by',
  // run-gate.js (3)
  'forge_get_active_run', 'forge_check_gate', 'forge_set_gate',
  // modules.js (2)
  'forge_read_modules', 'forge_assign_module',
  // model-mgmt.js (8)
  'forge_get_model_recommendation', 'forge_call_external', 'forge_read_usage',
  'forge_reset_usage', 'forge_update_agent_model', 'forge_add_model',
  'forge_update_model', 'forge_list_models',
  // run-lifecycle.js (11)
  'forge_create_run', 'forge_get_run', 'forge_list_runs', 'forge_update_run',
  'forge_classify_risk', 'forge_create_worktree', 'forge_escalate', 'forge_resume_run',
  'forge_advance_stage', 'forge_dashboard_state', 'forge_kill_worker',
  // knowledge.js (5)
  'forge_get_constraints', 'forge_get_patterns', 'forge_add_learning',
  'forge_read_criteria', 'forge_write_criteria',
];

// Import adapter — will fail until forge-worker-mcp.mjs is created.
const { default: buildInProcessMcpServer, REGISTERED_TOOL_NAMES, TEST_ONLY_callHandler } =
  await import('./forge-worker-mcp.mjs');

// AC-1 / AC-2: returned config has type:'sdk' and non-null instance
const config = buildInProcessMcpServer(process.cwd());
assert.strictEqual(config.type, 'sdk', 'config.type must be "sdk"');
assert.ok(
  config.instance !== null && typeof config.instance === 'object',
  'instance must be non-null object',
);
// No `command:` field — confirms old stdio entry is gone
assert.ok(
  !('command' in config),
  'config must not have a command: field (old stdio entry must be removed)',
);

// AC-3: all 38 tools registered
assert.deepStrictEqual(
  [...REGISTERED_TOOL_NAMES].sort(),
  [...EXPECTED_TOOLS].sort(),
  `Tool name mismatch.\nGot:      ${JSON.stringify([...REGISTERED_TOOL_NAMES].sort())}\nExpected: ${JSON.stringify([...EXPECTED_TOOLS].sort())}`,
);
assert.strictEqual(
  REGISTERED_TOOL_NAMES.length,
  38,
  `Expected 38 tools, got ${REGISTERED_TOOL_NAMES.length}`,
);

// AC-8: invoke a benign tool via TEST_ONLY_callHandler and assert stderr
// emits a JSON line with { tool, durationMs }.
assert.strictEqual(typeof TEST_ONLY_callHandler, 'function',
  'TEST_ONLY_callHandler must be exported');

// Capture stderr lines during handler invocation.
const stderrLines = [];
const origWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  stderrLines.push(typeof chunk === 'string' ? chunk : chunk.toString());
  return origWrite(chunk, ...rest);
};

// Call forge_get_active_run — read-only, will fail gracefully (no run file),
// but still must emit a timing line.
let timingResult;
try {
  timingResult = await TEST_ONLY_callHandler('forge_get_active_run', {});
} catch (_) {
  // handler may throw if env not set — timing line still emitted in catch block
}

process.stderr.write = origWrite; // restore

// Find a timing log line in captured stderr
const timingLine = stderrLines.find((l) => {
  try {
    const parsed = JSON.parse(l.trim());
    return (
      typeof parsed.tool === 'string' &&
      typeof parsed.durationMs === 'number' &&
      parsed.durationMs >= 0
    );
  } catch (_) {
    return false;
  }
});

assert.ok(
  timingLine !== undefined,
  `AC-8: expected a stderr JSON line with tool+durationMs keys.\nCaptured lines: ${JSON.stringify(stderrLines)}`,
);

const parsed = JSON.parse(timingLine.trim());
assert.strictEqual(parsed.tool, 'forge_get_active_run',
  `AC-8: timing line tool name must be 'forge_get_active_run', got '${parsed.tool}'`);
assert.ok(
  Number.isInteger(parsed.durationMs) && parsed.durationMs >= 0,
  `AC-8: durationMs must be a non-negative integer, got ${parsed.durationMs}`,
);

process.stderr.write('[inprocess-test] PASS — all 38 tools registered\n');
process.exit(0);
