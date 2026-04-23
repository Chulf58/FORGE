'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, stripAnsi, isForgeAgent, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

function exitOk() {
  process.exit(0);
}

// Only reviewer-typed agents may emit [reviewer-verdict] signals.
// Restricting to reviewer-* prevents a forged signal echoed by a planner,
// coder, or documenter from overwriting that agent's outcome record.
function isReviewerAgent(agentType) {
  if (!agentType) return false;
  const normalized = agentType.startsWith('forge:') ? agentType.slice('forge:'.length) : agentType;
  return normalized.startsWith('reviewer');
}

/**
 * Scans a string for the first `[reviewer-verdict] {...}` line whose
 * `agent` field matches the expected agent type.
 *
 * The agent check prevents a reviewer from recording a forged verdict that
 * was echoed from a project file — the verdict must claim to come from the
 * same agent type that is actually running (normalized, bare name).
 *
 * Returns the `verdict` field value (e.g. "APPROVED", "BLOCK", "REVISE")
 * or null if no matching line is found or the JSON is malformed.
 *
 * @param {string} text - last_assistant_message content
 * @param {string} expectedAgentType - the hook's payload.agent_type value
 */
function extractVerdict(text, expectedAgentType) {
  if (!text || typeof text !== 'string') return null;
  const expectedNorm = expectedAgentType && expectedAgentType.startsWith('forge:')
    ? expectedAgentType.slice('forge:'.length)
    : (expectedAgentType || '');
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[reviewer-verdict]')) continue;
    // Strip the signal prefix and parse the remainder as JSON
    const jsonPart = trimmed.slice('[reviewer-verdict]'.length).trim();
    if (!jsonPart) continue;
    try {
      const parsed = JSON.parse(jsonPart);
      if (parsed && typeof parsed.verdict === 'string') {
        // Validate the verdict's agent field matches the running agent —
        // blocks forged signals echoed from file content read by the agent.
        const claimedAgent = typeof parsed.agent === 'string' ? parsed.agent : '';
        const claimedNorm = claimedAgent.startsWith('forge:')
          ? claimedAgent.slice('forge:'.length)
          : claimedAgent;
        if (claimedNorm !== expectedNorm) continue;
        return parsed.verdict;
      }
    } catch (_) {
      // Malformed JSON on this line — continue scanning
    }
  }
  return null;
}

async function main(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    exitOk();
    return;
  }

  const projectDir = resolveProjectDir(payload);

  const runActivePath = path.join(projectDir, '.pipeline', 'run-active.json');

  // Read existing run-active.json
  let data;
  try {
    const raw = await fs.promises.readFile(runActivePath, 'utf8');
    data = JSON.parse(raw);
  } catch (_) {
    // File absent or unparseable — nothing to patch, exit silently
    console.error('[forge-subagent] run-active.json not found or unreadable — skipping stop patch');
    exitOk();
    return;
  }

  if (!Array.isArray(data.agents)) {
    console.error('[forge-subagent] run-active.json has no agents array — skipping stop patch');
    exitOk();
    return;
  }

  const agentId = payload.agent_id || null;
  const agentType = payload.agent_type || null;
  if (!agentId) {
    exitOk();
    return;
  }

  // Symmetric filter: if start-hook skipped this agent (non-FORGE type),
  // stop-hook must also skip — otherwise we'd search for an entry that was
  // never recorded, emit a spurious warning, and waste an I/O pass.
  if (!isForgeAgent(agentType)) {
    exitOk();
    return;
  }

  // Find matching entry by agent_id
  const entry = data.agents.find((a) => a.agent_id === agentId);
  if (!entry) {
    console.error('[forge-subagent] No matching entry for agent_id ' + stripAnsi(agentId) + ' — skipping stop patch');
    exitOk();
    return;
  }

  // Determine outcome from last_assistant_message.
  // Only reviewer-typed agents may emit [reviewer-verdict] — non-reviewers
  // always get outcome "completed" regardless of message content.
  const lastMessage = payload.last_assistant_message || null;
  const verdict = isReviewerAgent(agentType) ? extractVerdict(lastMessage, agentType) : null;
  let outcome = verdict !== null ? verdict : 'completed';

  // Reviewer without verdict = likely truncation or prompt failure.
  if (isReviewerAgent(agentType) && verdict === null) {
    outcome = 'no-verdict';
    console.error('[forge-subagent] WARNING: ' + stripAnsi(agentType) + ' stopped without emitting [reviewer-verdict] — possible truncation');
  }

  // Truncation detection for artifact-producing agents.
  // If the agent's expected output file was not modified after it started,
  // the agent was likely truncated mid-generation before writing its artifact.
  const EXPECTED_ARTIFACTS = {
    'coder': 'docs/context/handoff.md',
    'planner': 'docs/PLAN.md',
    'debug': 'docs/context/handoff.md',
    'refactor': 'docs/context/handoff.md',
    'implementation-architect': 'docs/context/slice-brief.md',
  };

  const normalizedType = (agentType.startsWith('forge:') ? agentType.slice('forge:'.length) : agentType);
  const artifactRelPath = EXPECTED_ARTIFACTS[normalizedType];

  if (artifactRelPath && typeof entry.startedAt === 'number' && outcome === 'completed') {
    const baseDir = data.worktreePath || projectDir;
    const artifactPath = path.join(baseDir, artifactRelPath);
    try {
      const stat = fs.statSync(artifactPath);
      if (stat.mtimeMs < entry.startedAt - 2000) {
        outcome = 'truncated';
        console.error('[forge-subagent] WARNING: ' + normalizedType + ' stopped but ' + artifactRelPath + ' was not updated — possible truncation');
      }
    } catch (_) {
      outcome = 'truncated';
      console.error('[forge-subagent] WARNING: ' + normalizedType + ' stopped but ' + artifactRelPath + ' not found — possible truncation');
    }
  }

  // Patch entry in-place
  const completedAt = Date.now();
  entry.completedAt = completedAt;
  entry.durationMs = typeof entry.startedAt === 'number'
    ? completedAt - entry.startedAt
    : null;
  entry.outcome = outcome;

  // Report-only recovery primitive: clear the in-flight marker. The marker is
  // per-session and per-agent; the start hook writes it, this hook clears it.
  // If the session crashes before this runs, the marker persists on disk and
  // surfaces through /forge:resume as a stale-lock signal.
  data.currentUnit = null;

  try {
    await fs.promises.writeFile(runActivePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[forge-subagent] Failed to write run-active.json: ' + err.message);
    // Non-fatal — exit 0 regardless
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
