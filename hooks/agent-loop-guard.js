'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

// Documenter is always exempt — a plan+implement+apply cycle dispatches it
// once per stage and must never be hard-stopped.
const EXEMPT_AGENTS = new Set(['documenter']);

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

  // Resolve runId from singleton run-active.json, then optionally per-run file.
  // Matches the resolution pattern in subagent-start.js.
  const singletonPath = path.join(projectDir, '.pipeline', 'run-active.json');

  let singletonData;
  try {
    const raw = await fs.promises.readFile(singletonPath, 'utf8');
    singletonData = JSON.parse(raw);
  } catch (_) {
    // No active run — conductor session or I/O error. Exit silently.
    exitOk();
    return;
  }

  const rawRunId = singletonData && typeof singletonData.runId === 'string'
    ? singletonData.runId
    : null;
  // Validate runId format to prevent path traversal.
  const validRunId = rawRunId && /^r-[a-zA-Z0-9]+$/.test(rawRunId) ? rawRunId : null;

  if (!validRunId) {
    // No valid runId — conductor session or uninitialised singleton. Exit silently.
    exitOk();
    return;
  }

  // Per-run fallback: check if a per-run run-active.json exists.
  const perRunPath = path.join(projectDir, '.pipeline', 'runs', validRunId, 'run-active.json');
  let runData = singletonData;
  try {
    const raw = await fs.promises.readFile(perRunPath, 'utf8');
    runData = JSON.parse(raw);
  } catch (_) {
    // Per-run file absent — keep singletonData as runData.
  }

  // Use the runId from whichever file we resolved (both should agree).
  const runId = (runData && typeof runData.runId === 'string' && /^r-[a-zA-Z0-9]+$/.test(runData.runId))
    ? runData.runId
    : validRunId;

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

  if (priorCount >= 2) {
    // Hard-stop: 3rd+ dispatch of this agent type in the run.
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
