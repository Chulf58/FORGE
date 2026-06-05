// mcp/lib/orchestrator/agent-dispatch.mjs
// Stateless agent dispatch primitive — wraps Anthropic SDK query() per-agent.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
 * @param {{ ok: boolean, reason?: string }|null} [opts.contentResult] - R3 content check (writer agents)
 * @param {string} opts.streamText - accumulated stream output
 * @param {RegExp} opts.completionPattern - pattern to test for readonly agents
 * @param {Error|null} opts.error - thrown error if any
 * @returns {{ outcome: 'completed'|'uncertain', reason?: string }}
 */
export function classifyOutcome({ agentKind, mtimeResult, contentResult, streamText, completionPattern, error }) {
  const contentOk = !contentResult || contentResult.ok;

  // Artifact-wins-over-stream-error: for writer agents, a present + fresh + content-
  // VALID output artifact proves the work landed — trust it even if the SDK stream
  // errored or aborted afterwards. Checked BEFORE the error path because intermittent
  // late stream aborts otherwise mark completed work 'uncertain' and block gate2
  // (run r-074b94ba: coder wrote a full handoff.md, the stream aborted ~5s later).
  // R3 adds the content gate so a truncated/degenerate write does NOT win here.
  // covers-verify runs afterwards as the net that still catches a broken impl.
  if (agentKind === 'writer' && mtimeResult && mtimeResult.ok && contentOk) {
    return { outcome: 'completed' };
  }

  // Error path — uncertain (retryable). Checked BEFORE the content-invalid path: a
  // stream abort can truncate the write, so a degenerate artifact + stream error
  // should RETRY (the transient class R2 handles), not escalate as content-junk.
  if (error) {
    return {
      outcome: 'uncertain',
      reason: 'dispatch error: ' + (error.message || String(error)),
    };
  }

  // R3 — writer wrote a present + fresh artifact whose CONTENT is degenerate, and the
  // stream did NOT error → the agent ran to completion and produced junk. NON-retryable
  // (a blind re-run reproduces it); surface the reason for escalation.
  if (agentKind === 'writer' && mtimeResult && mtimeResult.ok && contentResult && !contentResult.ok) {
    return {
      outcome: 'uncertain',
      reason: contentResult.reason || 'artifact content invalid',
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
  if (agentType === 'test-author') return '.pipeline/context/test-author-output.json';
  if (agentType === 'coder') return 'docs/context/handoff.md';
  if (agentType.startsWith('reviewer-')) return '.pipeline/context/reviewer-output/' + agentType + '.md';
  return null;
}

/**
 * R3: validate the CONTENT of a writer agent's artifact, not just its existence.
 * A present+fresh file can still be degenerate (the false-positive documented in
 * GENERAL.md): scout.json with files_to_read:[] (the agent had no real task), an
 * empty handoff.md, an empty reviewer verdict. Returns { ok, reason }. Conservative
 * by design — unknown types pass (do not over-gate; an over-blocking guard is worse
 * than the skip). Reasons never contain 'dispatch error', so a content failure is
 * correctly NON-retryable (isRetryableStreamError → false): the agent ran to
 * completion and produced junk, so a blind re-run reproduces it → escalate.
 * @param {string} agentType
 * @param {string} absPath - absolute path to the artifact
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateArtifactContent(agentType, absPath) {
  const read = () => {
    try { return { raw: readFileSync(absPath, 'utf-8') }; }
    catch (e) { return { err: (e && (e.code || e.message)) || 'unreadable' }; }
  };

  if (agentType === 'coder-scout') {
    const { raw, err } = read();
    if (err) return { ok: false, reason: 'artifact content invalid: scout.json unreadable (' + err + ')' };
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (_) { return { ok: false, reason: 'artifact content invalid: scout.json is not valid JSON' }; }
    // A scout is degenerate only when it identified NO work at all — neither existing
    // files to read NOR new files to create. A purely-additive (greenfield) feature
    // legitimately has files_to_read:[] with new_files populated; rejecting that on the
    // files_to_read check alone false-flagged a valid scout and tripped the G8 block
    // (soak r-1dc3d1fb).
    const readList = Array.isArray(parsed && parsed.files_to_read) ? parsed.files_to_read : [];
    const newList = Array.isArray(parsed && parsed.new_files) ? parsed.new_files : [];
    if (!parsed || (readList.length === 0 && newList.length === 0)) {
      return { ok: false, reason: 'artifact content invalid: scout.json lists no files to read or create (agent found no work)' };
    }
    return { ok: true };
  }

  if (agentType === 'coder') {
    const { raw, err } = read();
    if (err) return { ok: false, reason: 'artifact content invalid: handoff.md unreadable (' + err + ')' };
    if (raw.trim().length === 0) return { ok: false, reason: 'artifact content invalid: handoff.md is empty' };
    if (!/##\s+Files to (create|modify)/i.test(raw)) {
      return { ok: false, reason: 'artifact content invalid: handoff.md missing a "## Files to create/modify" section' };
    }
    return { ok: true };
  }

  if (agentType.startsWith('reviewer-')) {
    const { raw, err } = read();
    if (err) return { ok: false, reason: 'artifact content invalid: reviewer verdict unreadable (' + err + ')' };
    if (raw.trim().length === 0) return { ok: false, reason: 'artifact content invalid: reviewer verdict file is empty' };
    return { ok: true };
  }

  // Unknown writer type — do not over-gate.
  return { ok: true };
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
 * R4: the idempotent-retry contract, appended to every dispatched agent's systemPrompt.
 * R2 makes a retry HAPPEN (re-dispatch on a transient stream error); R4 makes it SAFE.
 * A retry re-runs the agent from scratch in the SAME worktree, so its output must be
 * idempotent — overwrite-same-file, never append/duplicate/incrementally extend — or a
 * second attempt corrupts the first attempt's output. Worktree isolation already makes
 * a re-dispatch overwrite-same-file at the FS level; this makes the agent honor it too.
 */
export const IDEMPOTENCY_CONTRACT = [
  '',
  '',
  '---',
  '',
  'Reliability contract (idempotent retry): your dispatch MAY be retried — e.g. after a',
  'transient stream abort. A retry re-runs you from scratch with the same inputs in the',
  'same worktree. Your output MUST be idempotent: rewrite the same files with the same',
  'content. Never append to, duplicate, or incrementally extend a file you may already',
  'have written on an earlier attempt. Producing the same result on a re-run as on the',
  'first run is required.',
].join('\n');

/**
 * Build the SDK query() params for a dispatched agent.
 *
 * CRITICAL: the SDK signature is query({ prompt, options }) (sdk.d.ts:2165) —
 * every field except `prompt` MUST be nested under `options`, or the SDK
 * silently ignores it and runs on defaults: default permission mode (every
 * Write/Edit prompts → blocked headless: "you haven't granted it yet"),
 * default model, no systemPrompt, and CLAUDE.md leaks via default settingSources.
 * Permission mode is `'default'` + a `canUseTool` callback (NOT `'bypassPermissions'`):
 * bypass disables the SDK's cwd write-confinement AND skips canUseTool, so a dispatched
 * agent could write to the main project root (81b8f299, run r-c73c9151). 'default' invokes
 * canUseTool before each tool; the callback ALLOWS in-worktree writes — so headless writes
 * still land, avoiding the r-15662c22 regression where coder-scout (no Bash escape hatch)
 * wrote no scout.json because its Write was permission-denied — and DENIES any Write/Edit
 * resolving outside workDir. (Bash write-targets aren't reliably parseable → Bash allowed.)
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
      // 81b8f299 worktree write-confinement. NOT 'bypassPermissions' — that disables the
      // SDK's cwd write-confinement AND skips canUseTool, letting a dispatched agent write to
      // the main project root (observed r-c73c9151). The plugin PreToolUse hook does NOT fire
      // for query() dispatches (settingSources:[] + headless — proven by dispatch-smoke-test),
      // so canUseTool is the only boundary that fires. It allows everything EXCEPT a Write/Edit
      // resolving outside workDir (in-worktree writes still land headlessly — no r-15662c22).
      // resolve(workDir, target): relative → under the worktree; absolute → itself.
      permissionMode: 'default',
      canUseTool: async (toolName, input) => {
        if (toolName === 'Write' || toolName === 'Edit') {
          const target = input && (input.file_path || input.path);
          if (typeof target === 'string' && target.length > 0) {
            const norm = (s) => s.replace(/\\/g, '/').toLowerCase();
            const w = norm(resolve(workDir));
            const t = norm(resolve(workDir, target));
            if (t !== w && !t.startsWith(w + '/')) {
              return {
                behavior: 'deny',
                message:
                  'FORGE: worktree write-confinement — a dispatched agent may only write under its ' +
                  'worktree (' + workDir + '). Blocked out-of-worktree write to: ' + target,
              };
            }
          }
        }
        return { behavior: 'allow', updatedInput: input };
      },
      settingSources: [],
      systemPrompt: agentBody + IDEMPOTENCY_CONTRACT,
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
  query: injectedQuery,
  retryOptions,
}) {
  // Validate agentType before any path construction — prevents path traversal.
  if (!AGENT_TYPE_PATTERN.test(agentType)) {
    throw new Error('Invalid agentType: ' + agentType + ' — must match /^[a-z0-9-]+$/');
  }

  // TEST SEAM: production omits `query`, so this dynamic-imports the real SDK (avoiding
  // a module-level SDK load, same pattern as forge-worker.mjs). A deterministic
  // recovery test injects a fault-injecting query to exercise the real R1→R2→R3 path.
  const query = injectedQuery || (await import('@anthropic-ai/claude-agent-sdk')).query;
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
    // R3: only validate content when the artifact is present + fresh — a stale/absent
    // file is already handled by the mtime check, and reading it would be wasted I/O.
    const contentResult = (agentKind === 'writer' && mtimeResult && mtimeResult.ok)
      ? validateArtifactContent(agentType, join(workDir, artifact))
      : null;

    return classifyOutcome({
      agentKind,
      mtimeResult,
      contentResult,
      streamText,
      completionPattern: COMPLETION_SIGNAL,
      error: streamError,
    });
  };

  return runWithRetry(attemptDispatch, retryOptions);
}
