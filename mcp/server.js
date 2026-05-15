// mcp/server.js — FORGE MCP server entry point.
//
// Thin registration shell: imports shared helpers + Zod schemas from
// `mcp/lib/tools/shared.js`, then dispatches tool registration to six
// domain modules under `mcp/lib/tools/`. Each domain module exports
// `register(server, shared)`. Adding tools to an existing domain belongs
// in that domain's module; adding a new domain belongs as a new module
// here.
//
// Tool layout (38 tools total):
//   board.js          —  9 tools (board / tasks / notes / project / blocked-by)
//   run-gate.js       —  3 tools (active run + gate read/write)
//   modules.js        —  2 tools (module map read + assignment)
//   model-mgmt.js     —  8 tools (router / external call / usage / catalog)
//   run-lifecycle.js  — 11 tools (create / get / list / update / classify / resume / advance / escalate / worktree / dashboard / kill)
//   knowledge.js      —  5 tools (constraints / patterns / learning / criteria read+write)
//
// History: prior to commit on 2026-05-15 (Phase 6 of r-c6626d2a), all
// 38 tools were inlined here (~3136 lines). Extraction shipped the
// monolith into per-domain modules; this shell preserves identical
// runtime behavior — tool names, schemas, handlers unchanged.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import * as shared from "./lib/tools/shared.js";

import { register as registerBoard } from "./lib/tools/board.js";
import { register as registerRunGate } from "./lib/tools/run-gate.js";
import { register as registerModules } from "./lib/tools/modules.js";
import { register as registerModelMgmt } from "./lib/tools/model-mgmt.js";
import { register as registerRunLifecycle } from "./lib/tools/run-lifecycle.js";
import { register as registerKnowledge } from "./lib/tools/knowledge.js";

const server = new McpServer({
  name: "forge-mcp-server",
  version: "1.0.0",
});

registerBoard(server, shared);
registerRunGate(server, shared);
registerModules(server, shared);
registerModelMgmt(server, shared);
registerRunLifecycle(server, shared);
registerKnowledge(server, shared);

const transport = new StdioServerTransport();
await server.connect(transport);
