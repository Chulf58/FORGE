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
  // Artifact-wins-over-stream-error: for writer agents, a present + fresh output
  // artifact proves the work landed — trust it even if the SDK stream errored or
  // aborted afterwards. Checked BEFORE the error path because intermittent late
  // stream aborts otherwise mark completed work 'uncertain' and block gate2
  // (run r-074b94ba: coder wrote a full handoff.md, the stream aborted ~5s later).
  // covers-verify runs afterwards as the net that still catches a broken impl.
  if (agentKind === 'writer' && mtimeResult && mtimeResult.ok) {
    return { outcome: 'completed' };
  }

  // Error path — uncertain, surface the error message.
  if (error) {
    return {
      outcome: 'uncertain',
      reason: 'dispatch error: ' + (error.message || String(error)),
    };
  }

  if (agentKind === 'writer') {
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
 * R1: detect a NON-throwing SDK `result` event signalling an error/abort. SDK
 * stream aborts/limits arrive as a `result` event (sdk.d.ts SDKResultError:
 * type:'result', subtype 'error_during_execution'|'error_max_turns'|… , is_error,
 * terminal_reason), NOT a thrown error — so the stream-drain's try/catch never sees
 * them. Returns a reason string for the dispatch-error path, or null for a normal,
 * non-result, or successful message.
 * @param {unknown} msg
 * @returns {string|null}
 */
export function errorResultReason(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const m = /** @type {Record<string, any>} */ (msg);
  if (m.type !== 'result') return null;
  const isErr = m.is_error === true || (typeof m.subtype === 'string' && m.subtype !== 'success');
  if (!isErr) return null;
  const sub = typeof m.subtype === 'string' ? m.subtype : 'error';
  const tr = m.terminal_reason ? ' (' + m.terminal_reason + ')' : '';
  return 'stream result error: ' + sub + tr;
}

/**
 * Drain an SDK query() stream: accumulate readable text and capture the FIRST
 * error signal — whether thrown OR a non-throwing error `result` event
 * (errorResultReason, R1). A thrown error is captured (not rethrown) so it surfaces
 * as 'uncertain' rather than a silent success (GENERAL.md: surface failures inline).
 * @param {AsyncIterable<unknown>} stream
 * @returns {Promise<{ streamText: string, streamError: Error|null }>}
 */
export async function drainStream(stream) {
  let streamText = '';
  let streamError = null;
  try {
    for await (const msg of stream) {
      streamText += '\n' + extractText(msg);
      if (streamError === null) {
        const resultErr = errorResultReason(msg);
        if (resultErr) streamError = new Error(resultErr);
      }
    }
  } catch (err) {
    streamError = err instanceof Error ? err : new Error(String(err));
  }
  return { streamText, streamError };
}

/**
 * R2: is this uncertain `reason` a transient STREAM error worth retrying? True for
 * thrown stream errors and non-throwing error `result` events (both surface as a
 * 'dispatch error: …' reason, R1). False for logic failures — missing artifact
 * ('file absent' / 'mtime check failed') or no completion signal — which a retry
 * would not fix.
 * @param {string|undefined|null} reason
 * @returns {boolean}
 */
export function isRetryableStreamError(reason) {
  return typeof reason === 'string' && reason.includes('dispatch error');
}

/**
 * R2: bounded exponential backoff with jitter (ms). `attempt` is 1-based.
 * base * 2^(attempt-1) + random jitter in [0, base), capped.
 * @param {number} attempt
 * @param {{ base?: number, cap?: number }} [opts]
 * @returns {number}
 */
export function retryDelayMs(attempt, { base = 2000, cap = 30000 } = {}) {
  const exp = base * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.random() * base;
  return Math.min(cap, exp + jitter);
}

/**
 * R2: run a dispatch attempt with bounded retry on transient stream errors.
 * `attemptFn(attempt)` returns { outcome, reason }. Retries (up to maxAttempts) ONLY
 * when the result is uncertain AND isRetryable(reason) — never on logic failures.
 * Sleeps delayFn(attempt) between attempts. Stamps `attempts` on the returned result.
 * Worktree isolation makes a re-dispatch overwrite-same-file (idempotent).
 * @param {(attempt:number) => Promise<{outcome:string, reason?:string}>} attemptFn
 * @param {{ maxAttempts?: number, isRetryable?: (r?:string)=>boolean, delayFn?: (n:number)=>number, sleep?: (ms:number)=>Promise<void> }} [opts]
 */
export async function runWithRetry(attemptFn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 2;
  const isRetryable = opts.isRetryable ?? isRetryableStreamError;
  const delayFn = opts.delayFn ?? retryDelayMs;
  const sleep = opts.sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms)));
  let result = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    result = await attemptFn(attempt);
    if (!result || result.outcome === 'completed' || attempt >= maxAttempts || !isRetryable(result.reason)) {
      if (result) result.attempts = attempt;
      return result;
    }
    await sleep(delayFn(attempt));
  }
  return result;
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
 * Build the SDK query() params for a dispatched agent.
 *
 * CRITICAL: the SDK signature is query({ prompt, options }) (sdk.d.ts:2165) —
 * every field except `prompt` MUST be nested under `options`, or the SDK
 * silently ignores it and runs on defaults: default permission mode (every
 * Write/Edit prompts → blocked headless: "you haven't granted it yet"),
 * default model, no systemPrompt, and CLAUDE.md leaks via default settingSources.
 * `bypassPermissions` additionally REQUIRES allowDangerouslySkipPermissions:true
 * (sdk.d.ts:1456), without which writes stay blocked. Regression: run r-15662c22
 * — coder-scout (no Bash escape hatch) wrote no scout.json because its Write was
 * permission-denied; test-author only landed its file by routing through Bash.
 *
 * @returns {{ prompt: string, options: object }}
 */
export function buildQueryParams({
  prompt,
  agentModel,
  agentBody,
  workDir,
  pluginRoot,
  buildMcpServer,
  agentMaxTurns,
}) {
  return {
    prompt,
    options: {
      model: agentModel,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      systemPrompt: agentBody,
      plugins: [{ type: 'local', path: pluginRoot }],
      mcpServers: { 'forge-pipeline': buildMcpServer(workDir) },
      cwd: workDir,
      ...(Number.isInteger(agentMaxTurns) && agentMaxTurns > 0 ? { maxTurns: agentMaxTurns } : {}),
    },
  };
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

  // R2: one attempt = dispatch the agent stream + verify the outcome. runWithRetry
  // re-runs ONLY on a transient stream error (isRetryableStreamError) — capped,
  // backoff+jitter; logic failures (missing artifact / no completion signal) do NOT
  // retry. Worktree isolation (cwd=workDir) makes a re-dispatch overwrite-same-file
  // safe. startMs is fixed across attempts so artifact-wins counts ANY attempt's write.
  const attemptDispatch = async () => {
    const stream = query(buildQueryParams({
      prompt,
      agentModel,
      agentBody,
      workDir,
      pluginRoot,
      buildMcpServer,
      agentMaxTurns,
    }));

    // Drain the stream fully (accumulate text for completion-signal detection;
    // capture the first error — thrown OR a non-throwing error `result` event, R1 —
    // so it surfaces as 'uncertain', not a silent success).
    const { streamText, streamError } = await drainStream(stream);

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
  };

  return runWithRetry(attemptDispatch);
}
