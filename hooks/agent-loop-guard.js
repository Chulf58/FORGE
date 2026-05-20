'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_SHORT, findActiveRun } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

// Documenter and researcher are always exempt — a plan+implement+apply cycle
// dispatches documenter once per stage; researcher re-dispatches on BLOCK-retry
// and must never be hard-stopped by the loop guard.
const EXEMPT_AGENTS = new Set(['documenter', 'researcher']);

// Cap dispatches per agent type per run. Set high enough to cover phased
// implements (each phase dispatches 1 coder + ~2 reviewers) plus retry
// headroom, while still catching runaway loops (which dispatch 20+).
// Raised from 2 → 15 after r-2329c669 hit the cap mid-Phase-2 of a
// 4-phase implement; 4-phase × ~3 dispatches per agent type / phase
// fits comfortably under 15.
const MAX_DISPATCHES_PER_AGENT_PER_RUN = 15;

function exitOk() {
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(JSON.stringify({ permissionDecision: 'deny', denyReason: reason }) + '\n');
  process.stderr.write(reason + '\n');
  process.exit(2);
}

async function main(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    exitOk();
    return;
  }

  // Only intercept Agent tool calls.
  if (!payload || payload.tool_name !== 'Agent') {
    exitOk();
    return;
  }

  const agentType = payload.tool_input && payload.tool_input.subagent_type
    ? payload.tool_input.subagent_type
    : null;

  // Normalize: strip the "forge:" prefix for consistent keying.
  const normalizedType = agentType
    ? (agentType.startsWith('forge:') ? agentType.slice('forge:'.length) : agentType)
    : null;

  // No agent type identifiable — cannot make a deny decision; fail open.
  if (!normalizedType) {
    exitOk();
    return;
  }

  // Documenter is always exempt.
  if (EXEMPT_AGENTS.has(normalizedType)) {
    exitOk();
    return;
  }

  const projectDir = resolveProjectDir(payload);

  // Resolve runId from payload fast-path first; fall back to registry enumeration.
  let runId = null;
  const payloadRunId = payload.run_id && typeof payload.run_id === 'string' ? payload.run_id : null;
  if (payloadRunId && /^r-[a-zA-Z0-9]+$/.test(payloadRunId)) {
    runId = payloadRunId;
  } else {
    const activeRun = await findActiveRun(projectDir);
    if (!activeRun) {
      // No active run — conductor session or I/O error. Exit silently.
      exitOk();
      return;
    }
    const rawRunId = activeRun.runId;
    runId = rawRunId && /^r-[a-zA-Z0-9]+$/.test(rawRunId) ? rawRunId : null;
  }

  if (!runId) {
    // No valid runId — conductor session. Exit silently.
    exitOk();
    return;
  }

  // Dedicated counter file — primary deny-decision source.
  // Race-free: this hook writes the counter itself; no dependency on SubagentStart timing.
  const countsDir = path.join(projectDir, '.pipeline', 'run-agent-counts');
  const countsPath = path.join(countsDir, runId + '.json');

  let counts = {};
  try {
    const raw = await fs.promises.readFile(countsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      counts = parsed;
    }
  } catch (_) {
    // File absent or unreadable — start fresh. Fail-open: a missing counter
    // means we allow the dispatch (false negative preferable to false positive).
  }

  const priorCount = typeof counts[normalizedType] === 'number' ? counts[normalizedType] : 0;

  // Sanitize for safe embedding in messages.
  const safeType = normalizedType.replace(/[\r\n]/g, ' ').trim();
  const safeRunId = runId.replace(/[\r\n]/g, ' ').trim();

  if (priorCount >= MAX_DISPATCHES_PER_AGENT_PER_RUN) {
    // Hard-stop: dispatch count has reached the configured cap.
    deny(
      '[forge-stuck] HARD STOP: Agent ' + safeType +
      ' has been dispatched ' + priorCount + ' times already in run ' + safeRunId +
      '. Denying to prevent stuck-loop token burn. Check the run for an unresolved loop.'
    );
    return; // unreachable — deny() calls process.exit(2)
  }

  // Dispatch is allowed. stdout is flushed synchronously on process.exit for
  // pipes, so emit the allow decision by calling exitOk() after the write.
  // The PreToolUse harness reads stdout for the decision; it does not wait for
  // process exit. Awaiting the write here ensures the counter survives between
  // dispatches without blocking the caller beyond a single file write.
  const newCount = priorCount + 1;
  const updatedCounts = Object.assign({}, counts, { [normalizedType]: newCount });

  try {
    await fs.promises.mkdir(countsDir, { recursive: true });
    await fs.promises.writeFile(countsPath, JSON.stringify(updatedCounts, null, 2), 'utf8');
  } catch (err) {
    process.stderr.write('[forge-loop-guard] counter write failed (non-fatal): ' + err.message + '\n');
  }

  exitOk();
}

// -- Stdin reader with timeout guard -----------------------------------------
let inputData = '';
const timer = setTimeout(() => {
  main(inputData || '{}').catch(() => process.exit(0));
}, STDIN_TIMEOUT_MS);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => { inputData += line + '\n'; });
rl.on('close', () => {
  clearTimeout(timer);
  main(inputData || '{}').catch(() => process.exit(0));
});
