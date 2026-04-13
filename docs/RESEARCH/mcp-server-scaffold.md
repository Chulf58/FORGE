# Research: MCP Server Scaffold for FORGE Plugin

**Date:** 2026-04-10
**Question:** How to build an MCP server using `@modelcontextprotocol/sdk` for a Claude Code plugin.

## Key facts

1. **Import from `@modelcontextprotocol/sdk/server/mcp.js` and `@modelcontextprotocol/sdk/server/stdio.js`** — these are the two imports needed for a stdio-based MCP server. The package requires ESM (`"type": "module"` in package.json).
2. **Use `server.registerTool()` (not `server.tool()`)** — the modern v2 API uses `registerTool` with a name string, config object (title, description, inputSchema, annotations), and async handler. `server.tool()` is deprecated.
3. **Plugin MCP servers go in `.mcp.json` at plugin root** — Claude Code auto-starts them when the plugin is enabled. Use `${CLAUDE_PLUGIN_ROOT}` for script paths and `${CLAUDE_PLUGIN_DATA}` for persistent node_modules.
4. **Errors use `isError: true` in the return object** — tool failures return `{ content: [{ type: "text", text: "..." }], isError: true }`, not thrown exceptions. Thrown exceptions become protocol-level errors invisible to the LLM.
5. **Dependencies install to `${CLAUDE_PLUGIN_DATA}`** — use a SessionStart hook that diffs `package.json` and runs `npm install` in the data dir. The MCP server then gets `NODE_PATH=${CLAUDE_PLUGIN_DATA}/node_modules`.

## Findings

### 1. Imports and server setup

The MCP TypeScript SDK (v1.29.0 stable, latest as of April 2026) exports classes from submodule paths with `.js` extensions (ESM convention):

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
```

Server instantiation:

```javascript
const server = new McpServer({
  name: "forge-mcp-server",
  version: "1.0.0"
});
```

Connect to stdio transport (the only transport needed for plugin-spawned servers):

```javascript
const transport = new StdioServerTransport();
await server.connect(transport);
```

**Critical:** Never use `console.log()` in a stdio server — it writes to stdout and corrupts JSON-RPC messages. Use `console.error()` for debug output (goes to stderr).

### 2. Tool registration

Tools are registered with `server.registerTool()`:

```javascript
server.registerTool(
  "get_pipeline_status",
  {
    title: "Get Pipeline Status",
    description: "Returns the current pipeline run state and board summary",
    inputSchema: z.object({
      projectDir: z.string().describe("Absolute path to the project directory")
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async ({ projectDir }) => {
    const status = await readPipelineStatus(projectDir);
    return {
      content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
      structuredContent: status
    };
  }
);
```

**Schema format:** Uses Zod schemas (not raw JSON Schema). The SDK converts Zod to JSON Schema automatically for the MCP protocol. Use `.describe()` on every field — descriptions are NOT auto-extracted from JSDoc.

**Tool naming:** Use `snake_case` with service prefix to avoid conflicts (e.g. `forge_get_status`, not `getStatus`).

**Annotations:** Optional hints about tool behavior:
- `readOnlyHint` — tool only reads data
- `destructiveHint` — tool modifies/deletes data
- `idempotentHint` — calling multiple times has same effect
- `openWorldHint` — tool accesses external systems

**Return format:**
```javascript
{
  content: [
    { type: "text", text: "Human-readable response" }
  ],
  structuredContent: { /* machine-readable data */ }  // optional
}
```

**Deprecated APIs to avoid:**
- `server.tool()` — use `server.registerTool()` instead
- `server.setRequestHandler(ListToolsRequestSchema, ...)` — use registerTool
- Manual handler registration

### 3. Error handling

Two levels of errors exist:

**Tool-level errors** (LLM can see and retry):
```javascript
server.registerTool("example_tool", { /* config */ }, async (params) => {
  try {
    const result = await doWork(params);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Failed: ${error.message}`
      }],
      isError: true
    };
  }
});
```

**Protocol-level errors** (invisible to LLM, connection may drop):
- Uncaught exceptions that crash the process
- Malformed JSON-RPC responses
- Transport failures

Rule: Always catch errors inside handlers and return `{ isError: true }` with a descriptive message. Never return raw stack traces.

### 4. Plugin integration — .mcp.json

Place `.mcp.json` at the plugin root:

```json
{
  "mcpServers": {
    "forge-pipeline": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.js"],
      "env": {
        "NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules"
      }
    }
  }
}
```

**Available environment variables in plugin MCP configs:**
- `${CLAUDE_PLUGIN_ROOT}` — absolute path to plugin install dir (changes on update)
- `${CLAUDE_PLUGIN_DATA}` — persistent dir at `~/.claude/plugins/data/{id}/` (survives updates)
- `${user_config.KEY}` — user-configured values from `userConfig` in plugin.json
- Standard env vars from the user's shell

**Lifecycle:**
- Plugin MCP servers start automatically when plugin is enabled
- Run `/reload-plugins` to reconnect after enable/disable mid-session
- Servers appear alongside manually configured MCP tools
- Managed through plugin installation, not `/mcp` commands

### 5. Dependency management — SessionStart hook pattern

Since `${CLAUDE_PLUGIN_ROOT}` changes on each plugin update, dependencies must live in `${CLAUDE_PLUGIN_DATA}`. The official pattern uses a SessionStart hook:

**In `hooks/hooks.json` (or merged into existing hooks):**
```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "diff -q \"${CLAUDE_PLUGIN_ROOT}/mcp/package.json\" \"${CLAUDE_PLUGIN_DATA}/package.json\" >/dev/null 2>&1 || (cd \"${CLAUDE_PLUGIN_DATA}\" && cp \"${CLAUDE_PLUGIN_ROOT}/mcp/package.json\" . && npm install) || rm -f \"${CLAUDE_PLUGIN_DATA}/package.json\""
          }
        ]
      }
    ]
  }
}
```

This:
1. Compares bundled `package.json` against the cached copy
2. If different (or first run), copies it to data dir and runs `npm install`
3. If install fails, removes the copy so next session retries

The MCP server script then resolves modules via `NODE_PATH`:

```json
{
  "mcpServers": {
    "forge-pipeline": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.js"],
      "env": {
        "NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules"
      }
    }
  }
}
```

### 6. Package setup

The MCP server needs its own `package.json` for dependency tracking (placed at e.g. `mcp/package.json` in the plugin):

```json
{
  "name": "forge-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.25.0"
  }
}
```

**Key requirements:**
- `"type": "module"` — required, the SDK is ESM-only
- Node.js 18+ — minimum runtime version
- `zod` — peer dependency required for input schema validation (SDK uses `zod/v4` internally but is backwards-compatible with Zod v3.25+)
- No build step needed — plain `.js` files with ESM imports work directly

**Server entry point** (`mcp/server.js`):
```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "forge-mcp-server",
  version: "1.0.0"
});

// Register tools here...

const transport = new StdioServerTransport();
await server.connect(transport);
```

### 7. Complete minimal example

```javascript
// mcp/server.js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const server = new McpServer({
  name: "forge-mcp-server",
  version: "1.0.0"
});

server.registerTool(
  "forge_board_summary",
  {
    title: "FORGE Board Summary",
    description: "Returns a summary of the pipeline board (TODO/PLANNED tasks)",
    inputSchema: z.object({
      projectDir: z.string().describe("Absolute path to the project root")
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    }
  },
  async ({ projectDir }) => {
    try {
      const boardPath = join(projectDir, ".pipeline", "board.json");
      const raw = await readFile(boardPath, "utf-8");
      const board = JSON.parse(raw);
      const summary = {
        total: board.tasks?.length ?? 0,
        byStatus: {}
      };
      for (const task of board.tasks ?? []) {
        const status = task.status || "UNKNOWN";
        summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
      }
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        structuredContent: summary
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to read board: ${error.message}` }],
        isError: true
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### 8. Windows considerations

On Windows (this plugin's primary platform):
- Use `node` as the command (not `npx`) — avoids the `cmd /c` wrapper requirement
- Use `path.join()` / `path.resolve()` in server code — never string-concatenate paths
- The `diff -q` command in the SessionStart hook works in Git Bash (Claude Code's shell on Windows)
- `NODE_PATH` uses OS-appropriate separators automatically

### 9. File layout for FORGE plugin

Proposed addition to the plugin:

```
forge-plugin/
├── .mcp.json                    # NEW — MCP server declaration
├── mcp/
│   ├── package.json             # NEW — dependencies (installed to CLAUDE_PLUGIN_DATA)
│   └── server.js                # NEW — MCP server entry point
└── hooks/
    └── hooks.json               # MODIFIED — add SessionStart hook for npm install
```

## Sources

- [MCP TypeScript SDK — GitHub](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP TypeScript SDK — Server docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)
- [Anthropic Skills — Node MCP Server Reference](https://github.com/anthropics/skills/blob/main/skills/mcp-builder/reference/node_mcp_server.md)
- [Claude Code — Connect to tools via MCP](https://code.claude.com/docs/en/mcp)
- [Claude Code — Plugins Reference](https://code.claude.com/docs/en/plugins-reference)
- [@modelcontextprotocol/sdk on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [MCP Server in plain JS — GitHub example](https://github.com/lucianoayres/mcp-server-node)
