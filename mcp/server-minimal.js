import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "forge-mcp-server",
  version: "1.0.0"
});

server.registerTool(
  "forge_ping",
  {
    title: "FORGE Ping",
    description: "Returns a known response to verify the MCP server is running.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  },
  async () => {
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, ts: new Date().toISOString(), cwd: process.cwd() }) }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
