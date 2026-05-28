// mcp/lib/orchestrator/agent-dispatch.mjs
// Stateless agent dispatch primitive — wraps Anthropic SDK query() per-agent.

// Allowed agent type characters — prevents path traversal via agentType parameter.
const AGENT_TYPE_PATTERN = /^[a-z0-9-]+$/;

/**
 * Parse YAML frontmatter and body from a markdown agent file.
 *
 * @param {string} content - raw file content
 * @returns {{ frontmatter: Record<string, string>, body: string }}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  const fm = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > -1) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      fm[key] = value;
    }
  }
  return { frontmatter: fm, body: match[2] };
}

/**
 * Dispatches a single agent via the Anthropic SDK query() stream.
 * Loads agents/<agentType>.md, extracts model from frontmatter and body as systemPrompt.
 *
 * @param {object} opts
 * @param {string} opts.agentType - e.g. 'planner', 'gotcha-checker', 'plan-skeptic'
 * @param {string[]} opts.promptLines - prepended signals + agent instructions
 * @param {string} opts.workDir - worker cwd (worktree path)
 * @param {string} opts.pluginRoot - plugin root path
 * @param {string} opts.systemPromptPath - path to CLAUDE-WORKER.md (kept for caller compatibility)
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
  // Validate agentType before any path construction — prevents path traversal.
  if (!AGENT_TYPE_PATTERN.test(agentType)) {
    throw new Error('Invalid agentType: ' + agentType + ' — must match /^[a-z0-9-]+$/');
  }

  // Dynamic import to avoid loading SDK at module level (same pattern as forge-worker.mjs)
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');

  // Load agents/<agentType>.md and extract model + body for systemPrompt.
  const agentFilePath = join(pluginRoot, 'agents', agentType + '.md');
  const agentContent = readFileSync(agentFilePath, 'utf-8');
  const { frontmatter, body: agentBody } = parseFrontmatter(agentContent);

  // Use model from agent frontmatter; fall back to default if absent.
  // Default: model: 'claude-sonnet-4-6' — overridden when frontmatter.model is set.
  const agentModel = frontmatter.model || 'claude-sonnet-4-6';

  // Parse maxTurns from frontmatter — only propagate when declared as a positive integer.
  // OMIT the field entirely when absent/invalid so the SDK default still applies.
  const agentMaxTurns = Number.parseInt(frontmatter.maxTurns, 10);

  // systemPromptPath (CLAUDE-WORKER.md) kept in signature for caller compatibility.
  // Legacy callers that pass systemPromptPath can do: readFileSync(systemPromptPath, 'utf-8')
  // but the authoritative systemPrompt now comes from the agent file body, not CLAUDE-WORKER.md.

  const prompt = promptLines.join('\n');

  const stream = query({
    prompt,
    model: agentModel,
    permissionMode: 'bypassPermissions',
    settingSources: [],
    systemPrompt: agentBody,
    plugins: [{ type: 'local', path: pluginRoot }],
    mcpServers: { 'forge-pipeline': buildMcpServer(workDir) },
    cwd: workDir,
    ...(Number.isInteger(agentMaxTurns) && agentMaxTurns > 0 ? { maxTurns: agentMaxTurns } : {}),
  });

  // Drain the stream fully
  for await (const _msg of stream) {
    // consume — no-op
  }

  return { outcome: 'completed' };
}
