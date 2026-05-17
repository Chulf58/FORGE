// mcp/forge-worker-mcp.test.mjs
// @covers mcp/forge-worker-mcp.mjs
//
// TDD guard test — must fail (red) before forge-worker-mcp.mjs is created,
// pass (green) after.
//
// Uses node:test so the guard can run it with `node --test`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('forge-worker-mcp', () => {
  it('buildInProcessMcpServer returns type:sdk config', async () => {
    const { default: buildInProcessMcpServer } = await import('./forge-worker-mcp.mjs');
    const config = buildInProcessMcpServer(process.cwd());
    assert.strictEqual(config.type, 'sdk');
    assert.ok(config.instance !== null && typeof config.instance === 'object');
  });

  it('registers all 38 forge_* tools', async () => {
    const { default: buildInProcessMcpServer, REGISTERED_TOOL_NAMES } =
      await import('./forge-worker-mcp.mjs');
    buildInProcessMcpServer(process.cwd());
    assert.strictEqual(REGISTERED_TOOL_NAMES.length, 38);
  });

  it('TEST_ONLY_callHandler returns isError:true for __test_throw__', async () => {
    const { TEST_ONLY_callHandler } = await import('./forge-worker-mcp.mjs');
    const result = await TEST_ONLY_callHandler('__test_throw__', {});
    assert.strictEqual(result.isError, true);
    assert.ok(Array.isArray(result.content));
  });
});
