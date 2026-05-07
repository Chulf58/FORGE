import { query } from "@anthropic-ai/claude-agent-sdk";

const result = await query({
  prompt: "Say 'hello' and nothing else.",
  options: {
    maxTurns: 1,
    permissionMode: "bypassPermissions",
  },
});

console.log("Result:", result);
