// mcp/lib/orchestrator/agent-dispatch.mjs
// Stateless agent dispatch primitive — wraps Anthropic SDK query() per-agent.

/**
 * Dispatches a single agent via the Anthropic SDK query() stream.
 *
 * @param {object} opts
 * @param {string} opts.agentType - e.g. 'planner', 'gotcha-checker', 'plan-skeptic'
 * @param {string[]} opts.promptLines - prepended signals + agent instructions
 * @param {string} opts.workDir - worker cwd (worktree path)
 * @param {string} opts.pluginRoot - plugin root path
 * @param {string} opts.systemPromptPath - path to CLAUDE-WORKER.md
 * @param {function(string): object} opts.buildMcpServer - factory: (workDir) => MCP server object
 * @returns {Promise<{ outcome: 'completed' }>}
 */
export async function dispatchAgent({
  agentType,
  promptLines,
  workDir,
  pluginRoot,
  systemPromptPath,
  buildMcpServer,
}) {
  // Dynamic import to avoid loading SDK at module level (same pattern as forge-worker.mjs)
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const { readFileSync } = await import('node:fs');

  const systemPrompt = readFileSync(systemPromptPath, 'utf-8');
  const prompt = promptLines.join('\n');

  const stream = query({
    prompt,
    model: 'claude-sonnet-4-6',
    permissionMode: 'bypassPermissions',
    settingSources: [],
    systemPrompt,
    plugins: [{ type: 'local', path: pluginRoot }],
    mcpServers: { 'forge-pipeline': buildMcpServer(workDir) },
    cwd: workDir,
  });

  // Drain the stream fully
  for await (const _msg of stream) {
    // consume — no-op
  }

  return { outcome: 'completed' };
}
