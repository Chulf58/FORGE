// mcp/lib/orchestrator/agent-dispatch.mjs
// Stateless agent dispatch primitive — wraps Anthropic SDK query() per-agent.

import { checkMtime } from '../../../scripts/verify-output.mjs';

// Allowed agent type characters — prevents path traversal via agentType parameter.
const AGENT_TYPE_PATTERN = /^[a-z0-9-]+$/;

/**
 * Sentinel lines emitted by readonly agents to signal completion.
 * Matches bracket-delimited tokens only — prevents false positives on prose.
 * Known-good lines: [completeness-ok], [APPROVED], [verdict], [verdict-final], [reviewer-verdict]
 */
export const COMPLETION_SIGNAL = /\[\s*(?:completeness-ok|APPROVED|verdict(?:-final)?|reviewer-verdict)\s*\]/i;

/**
 * Classify a dispatch result as 'completed' or 'uncertain'.
 *
 * @param {object} opts
 * @param {'writer'|'readonly'} opts.agentKind
 * @param {{ ok: boolean, reason: string }|null} opts.mtimeResult - for writer agents
 * @param {string} opts.streamText - accumulated stream output
 * @param {RegExp} opts.completionPattern - pattern to test for readonly agents
 * @param {Error|null} opts.error - thrown error if any
 * @returns {{ outcome: 'completed'|'uncertain', reason?: string }}
 */
export function classifyOutcome({ agentKind, mtimeResult, streamText, completionPattern, error }) {
  // Error path — always uncertain, surface the error message.
  if (error) {
    return {
      outcome: 'uncertain',
      reason: 'dispatch error: ' + (error.message || String(error)),
    };
  }

  if (agentKind === 'writer') {
    // Safe non-null: mtimeResult is required for writer agents.
    // eslint-disable-next-line no-extra-boolean-cast
    if (mtimeResult && mtimeResult.ok) {
      return { outcome: 'completed' };
    }
    return {
      outcome: 'uncertain',
      reason: (mtimeResult && mtimeResult.reason) ? mtimeResult.reason : 'mtime check failed',
    };
  }

  // readonly — check completion pattern against stream text.
  if (completionPattern.test(streamText)) {
    return { outcome: 'completed' };
  }
  return {
    outcome: 'uncertain',
    reason: 'no completion signal detected in stream output',
  };
}

/**
 * Readonly agents are verified by a completion signal in their stream output
 * (they do not write a single canonical artifact). All others are verified by
 * output-file mtime.
 */
const READONLY_AGENTS = new Set(['completeness-checker', 'gotcha-checker']);

/**
 * Map a writer agentType to its expected output artifact (relative to workDir).
 * Reviewers write reviewer-output/<agentType>.md. Returns null when no single
 * artifact is known — caller treats that as readonly (best-effort signal check).
 * @param {string} agentType
 * @returns {string|null}
 */
export function expectedArtifact(agentType) {
  if (agentType === 'coder-scout') return 'docs/context/scout.json';
  if (agentType === 'coder') return 'docs/context/handoff.md';
  if (agentType.startsWith('reviewer-')) return '.pipeline/context/reviewer-output/' + agentType + '.md';
  return null;
}

/**
 * Best-effort extraction of readable text from an SDK stream message. Falls back
 * to JSON so completion-signal detection is robust to message shape.
 * @param {unknown} msg
 * @returns {string}
 */
function extractText(msg) {
  if (msg == null) return '';
  if (typeof msg === 'string') return msg;
  const m = /** @type {Record<string, any>} */ (msg);
  if (m.message && Array.isArray(m.message.content)) {
    return m.message.content
      .map((c) => (typeof c === 'string' ? c : (c && c.text) || ''))
      .join(' ');
  }
  if (typeof m.text === 'string') return m.text;
  if (typeof m.result === 'string') return m.result;
  try { return JSON.stringify(msg); } catch (_) { return ''; }
}

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
 * @returns {Promise<{ outcome: 'completed'|'uncertain', reason?: string }>}
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

  // Capture before the stream starts — the mtime check asks "was the output
  // written AFTER dispatch began?", so `since` must predate the agent's writes.
  const startMs = Date.now();

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

  // Drain the stream fully, accumulating text for completion-signal detection.
  // A thrown stream error is captured (not rethrown) so it surfaces as
  // 'uncertain' rather than a silent success (GENERAL.md: surface failures inline).
  let streamText = '';
  let streamError = null;
  try {
    for await (const msg of stream) {
      streamText += '\n' + extractText(msg);
    }
  } catch (err) {
    streamError = err instanceof Error ? err : new Error(String(err));
  }

  // AC-38: verify the outcome instead of blindly reporting success. Writer
  // agents are checked by output-file mtime; readonly agents by completion
  // signal; any stream error → uncertain.
  const artifact = READONLY_AGENTS.has(agentType) ? null : expectedArtifact(agentType);
  const agentKind = artifact ? 'writer' : 'readonly';
  const mtimeResult = agentKind === 'writer'
    ? checkMtime(join(workDir, artifact), startMs)
    : null;

  return classifyOutcome({
    agentKind,
    mtimeResult,
    streamText,
    completionPattern: COMPLETION_SIGNAL,
    error: streamError,
  });
}
