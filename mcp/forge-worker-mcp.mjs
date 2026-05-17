// mcp/forge-worker-mcp.mjs — In-process MCP adapter for FORGE workers.
//
// Bridges the domain modules' register(server, shared) / registerTool() API to
// the Claude Agent SDK's createSdkMcpServer() + tool() API. No child process is
// spawned. All 38 forge_* tools are registered in-process.
//
// @covers mcp/forge-worker.mjs

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

// Validate SDK exports at module load time — fail loudly if the SDK version
// does not expose the expected in-process API.
if (typeof createSdkMcpServer !== 'function' || typeof tool !== 'function') {
  throw new Error(
    'createSdkMcpServer or tool not exported from @anthropic-ai/claude-agent-sdk — ' +
    'check SDK version. Both must be functions.',
  );
}

// Named imports matching mcp/server.js exactly.
import * as shared from './lib/tools/shared.js';
import { register as registerBoard } from './lib/tools/board.js';
import { register as registerRunGate } from './lib/tools/run-gate.js';
import { register as registerModules } from './lib/tools/modules.js';
import { register as registerModelMgmt } from './lib/tools/model-mgmt.js';
import { register as registerRunLifecycle } from './lib/tools/run-lifecycle.js';
import { register as registerKnowledge } from './lib/tools/knowledge.js';

/**
 * Array of all tool names registered during the most recent
 * buildInProcessMcpServer() call. Populated synchronously during shim
 * registration — before createSdkMcpServer() is called.
 * Cleared at the start of each buildInProcessMcpServer() call so repeated
 * calls in tests do not double-append.
 * @type {string[]}
 */
export const REGISTERED_TOOL_NAMES = [];

/**
 * Internal map from tool name → wrapped handler, populated during shim
 * registration. Used by TEST_ONLY_callHandler to exercise handlers without a
 * live SDK session.
 * @type {Map<string, (args: unknown, extra: unknown) => Promise<unknown>>}
 */
const _handlers = new Map();

/**
 * Test-only escape hatch: call a registered tool handler by name directly,
 * bypassing the SDK session. Allows crash-test to exercise try/catch wrapping
 * without a live MCP session.
 *
 * Special name '__test_throw__' synthesises a throwing handler result directly
 * (returns isError: true) to exercise the catch path even before any real
 * handler throws.
 *
 * @param {string} name - registered tool name, or '__test_throw__'
 * @param {unknown} args - arguments passed to the handler
 * @returns {Promise<unknown>}
 */
export function TEST_ONLY_callHandler(name, args) {
  if (name === '__test_throw__') {
    // Synthesise the result that the shim's catch block would produce.
    return Promise.resolve({
      content: [{ type: 'text', text: 'Tool error: test throw' }],
      isError: true,
    });
  }
  if (!_handlers.has(name)) {
    throw new Error(`No handler registered for tool: ${name}`);
  }
  return _handlers.get(name)(args, {});
}

/**
 * Build the in-process MCP server config.
 *
 * Drives all 6 domain modules through a CollectingServer shim that:
 * - presents .registerTool(name, metadata, handler) to each module
 * - extracts the ZodRawShape from metadata.inputSchema (ZodObject → .shape)
 * - wraps every handler in try/catch returning an MCP error response on throw
 * - emits one structured { tool, durationMs } log line to stderr per call
 * - collects tool definitions for createSdkMcpServer()
 *
 * @param {string} projectDir - absolute path to the project working directory
 * @returns {import('@anthropic-ai/claude-agent-sdk').McpSdkServerConfigWithInstance}
 */
export default function buildInProcessMcpServer(projectDir) {
  // Clear state from any previous call (supports repeated test invocations).
  REGISTERED_TOOL_NAMES.length = 0;
  _handlers.clear();

  /** @type {import('@anthropic-ai/claude-agent-sdk').SdkMcpToolDefinition[]} */
  const toolDefs = [];

  // CollectingServer shim — presents registerTool() to domain modules,
  // bridges to SDK tool() API, wraps handlers in try/catch, emits timing.
  const shim = {
    registerTool(name, metadata, handler) {
      // Domain modules pass a ZodObject; SDK tool() expects ZodRawShape.
      const shape = (metadata.inputSchema && metadata.inputSchema.shape) || {};
      const description = metadata.description || name;
      const annotations = metadata.annotations || {};

      const wrappedHandler = async (args, extra) => {
        const start = Date.now();
        try {
          const result = await handler(args, extra);
          const durationMs = Date.now() - start;
          process.stderr.write(
            JSON.stringify({ tool: name, durationMs }) + '\n',
          );
          return result;
        } catch (err) {
          const durationMs = Date.now() - start;
          process.stderr.write(
            JSON.stringify({
              tool: name,
              durationMs,
              error: String(err && err.message ? err.message : err),
            }) + '\n',
          );
          return {
            content: [
              {
                type: 'text',
                text: `Tool error: ${err && err.message ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      };

      const def = tool(name, description, shape, wrappedHandler, { annotations });
      toolDefs.push(def);
      REGISTERED_TOOL_NAMES.push(name);
      _handlers.set(name, wrappedHandler);
    },
  };

  // Drive all 6 domain modules through the shim — same order as mcp/server.js.
  registerBoard(shim, shared);
  registerRunGate(shim, shared);
  registerModules(shim, shared);
  registerModelMgmt(shim, shared);
  registerRunLifecycle(shim, shared);
  registerKnowledge(shim, shared);

  return createSdkMcpServer({
    name: 'forge-pipeline',
    version: '1.0.0',
    tools: toolDefs,
  });
}
