'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, stripAnsi, isForgeAgent, resolvePluginRoot, STDIN_TIMEOUT_SHORT, findActiveRun } = require('./hook-utils');

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

// Non-reviewer agents that legitimately emit [reviewer-verdict] signals.
// These receive the same verdict extraction and no-verdict truncation check
// as reviewer-typed agents.
const VERDICT_AGENTS = new Set(['completeness-checker']);

function isVerdictEmittingAgent(agentType) {
  if (!agentType) return false;
  const normalized = agentType.startsWith('forge:') ? agentType.slice('forge:'.length) : agentType;
  return normalized.startsWith('reviewer') || VERDICT_AGENTS.has(normalized);
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

/**
 * Resolves the provider and model ID for a given agent type by reading
 * the most recent matching entry from session-dispatch-log.json.
 *
 * @param {string} projectDir
 * @param {string} normalizedType - bare agent name (no "forge:" prefix)
 * @returns {Promise<{ providerId: string|null, modelId: string|null }>}
 */
async function resolveAgentModel(projectDir, normalizedType) {
  try {
    const logPath = path.join(projectDir, '.pipeline', 'session-dispatch-log.json');
    let raw;
    try {
      raw = await fs.promises.readFile(logPath, 'utf8');
    } catch (_) {
      return { providerId: null, modelId: null };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return { providerId: null, modelId: null };
    }
    if (!parsed || !Array.isArray(parsed.entries)) {
      return { providerId: null, modelId: null };
    }
    // Find the most recent entry matching agentName
    let best = null;
    for (const entry of parsed.entries) {
      if (entry && entry.agentName === normalizedType) {
        if (!best || (entry.ts && entry.ts > best.ts)) {
          best = entry;
        }
      }
    }
    if (!best) {
      return { providerId: null, modelId: null };
    }
    return {
      providerId: typeof best.providerId === 'string' ? best.providerId : null,
      modelId: typeof best.modelId === 'string' ? best.modelId : null,
    };
  } catch (_) {
    return { providerId: null, modelId: null };
  }
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

  // Resolve runId via per-run file enumeration (payload carries no run_id field).
  // findActiveRun returns null when zero or multiple non-terminal runs exist — fail open.
  const activeRun = await findActiveRun(projectDir);
  if (!activeRun) {
    // No active run found — nothing to patch, exit silently.
    exitOk();
    return;
  }
  const { runId: validRunId } = activeRun;

  // Read the per-run active file using the resolved runId.
  const runActivePath = path.join(projectDir, '.pipeline', 'runs', validRunId, 'run-active.json');
  let data;
  try {
    const raw = await fs.promises.readFile(runActivePath, 'utf8');
    data = JSON.parse(raw);
  } catch (_) {
    // Per-run active file absent or unparseable — exit silently (fail-open).
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
  // Reviewer-typed agents and VERDICT_AGENTS (e.g. completeness-checker) may
  // emit [reviewer-verdict] — all others always get outcome "completed"
  // regardless of message content.
  const lastMessage = payload.last_assistant_message || null;
  const verdict = isVerdictEmittingAgent(agentType) ? extractVerdict(lastMessage, agentType) : null;
  let outcome = verdict !== null ? verdict : 'completed';

  // Verdict-emitting agent without verdict = likely truncation or prompt failure.
  if (isVerdictEmittingAgent(agentType) && verdict === null) {
    outcome = 'no-verdict';
    console.error('[forge-subagent] WARNING: ' + stripAnsi(agentType) + ' stopped without emitting [reviewer-verdict] — possible truncation');
  }

  // Truncation detection for the coder agent — check git diff rather than
  // artifact mtime, since source files are now the primary coder output.
  // Guard with data.worktreePath: skip this check for non-worktree runs.
  const normalizedType = (agentType.startsWith('forge:') ? agentType.slice('forge:'.length) : agentType);

  // Checkpoint detection — must run BEFORE the truncation blocks below so
  // a checkpoint outcome is not overridden by the artifact-mtime check.
  // Condition: agent emitted [CONTEXT-CHECKPOINT] AND checkpoint file exists.
  if (outcome === 'completed' || outcome === 'no-verdict') {
    const hasCheckpointSignal = (() => {
      if (!lastMessage || typeof lastMessage !== 'string') return false;
      const lines = lastMessage.split('\n');
      return lines.some((l) => l.trim() === '[CONTEXT-CHECKPOINT]');
    })();

    if (hasCheckpointSignal) {
      const baseDir = data.worktreePath || projectDir;
      const checkpointPath = path.join(baseDir, 'docs', 'context', 'checkpoint.md');
      const checkpointExists = (() => {
        try { fs.statSync(checkpointPath); return true; } catch (_) { return false; }
      })();

      if (checkpointExists) {
        outcome = 'checkpoint';
        console.error('[forge-subagent] ' + normalizedType + ' emitted [CONTEXT-CHECKPOINT] + checkpoint.md exists — stamping outcome: checkpoint');
      } else {
        // Signal without file — orphan signal; log and fall through to normal outcome
        console.error('[forge-subagent] WARNING: ' + normalizedType + ' emitted [CONTEXT-CHECKPOINT] but checkpoint.md not found — treating as completed');
      }
    }
  }

  if (normalizedType === 'coder' && data.worktreePath && outcome === 'completed') {
    try {
      const { spawnSync } = require('child_process');
      const result = spawnSync('git', ['diff', '--quiet', 'HEAD'], { cwd: data.worktreePath });
      if (result.error) {
        // git not found or worktree path invalid — fail-open, assume not truncated
        console.error('[forge-subagent] coder git diff check failed: ' + result.error.message + ' — assuming completed');
      } else if (result.status === 0) {
        // exit 0 = no changes present — coder produced no diff, likely truncated
        outcome = 'truncated';
        console.error('[forge-subagent] WARNING: coder stopped but git diff shows no changes — possible truncation');
      }
      // exit non-zero = changes present — outcome stays 'completed'
    } catch (err) {
      // spawnSync threw — fail-open
      console.error('[forge-subagent] coder git diff check threw: ' + err.message + ' — assuming completed');
    }
  }

  // Truncation detection for the gotcha-checker agent.
  // The agent's output always ends with a "### Verdict" section. If that
  // section is absent from the last message, the agent was truncated before
  // completing its analysis.
  if (normalizedType === 'gotcha-checker' && outcome === 'completed') {
    const msg = lastMessage || '';
    if (!msg.includes('### Verdict')) {
      outcome = 'truncated';
      console.error('[forge-subagent] WARNING: gotcha-checker stopped but no "### Verdict" section found — possible truncation');
    }
  }

  // Truncation detection for artifact-producing agents.
  // If the agent's expected output file was not modified after it started,
  // the agent was likely truncated mid-generation before writing its artifact.
  const EXPECTED_ARTIFACTS = {
    'planner': 'docs/PLAN.md',
    'debug': 'docs/context/handoff.md',
    'refactor': 'docs/context/handoff.md',
    'implementation-architect': 'docs/context/slice-brief.md',
    'researcher': 'docs/context/researcher-status.json',
  };

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
    const tmp = runActivePath + '.tmp.' + process.pid;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.promises.rename(tmp, runActivePath);
  } catch (err) {
    console.error('[forge-subagent] Failed to write run-active.json: ' + err.message);
    // Non-fatal — exit 0 regardless
  }

  // Dual-write: sync agents array to run registry on completion.
  // Follows the stages dual-write pattern from subagent-start.js.
  if (data.runId) {
    try {
      const pluginRoot = resolvePluginRoot();
      const coreIndex = path.join(pluginRoot, 'packages', 'forge-core', 'src', 'runs', 'index.js');
      const coreMod = await import('file:///' + coreIndex.replace(/\\/g, '/'));
      const updateRunCore = coreMod.updateRun;

      // Transform snake_case → camelCase for RunAgent schema compatibility
      const registryAgents = data.agents.map(a => ({
        agentId: a.agent_id || '',
        agentType: a.agent_type || null,
        startedAt: a.startedAt,
        completedAt: a.completedAt || null,
        durationMs: a.durationMs || null,
        outcome: a.outcome || null,
      }));

      updateRunCore(projectDir, data.runId, { agents: registryAgents });
    } catch (syncErr) {
      console.error('[forge-subagent] agents registry sync failed: ' + syncErr.message);
      // Non-fatal — proceed
    }
  }

  // Record Anthropic usage — one request per native agent dispatch.
  // Token count is 0: SubagentStop payload does not include token data.
  const { providerId: agentProviderId, modelId: agentModelId } = await resolveAgentModel(projectDir, normalizedType);
  if (agentProviderId === 'anthropic') {
    try {
      const pluginRoot = resolvePluginRoot();
      const usageStorePath = path.join(pluginRoot, 'mcp', 'lib', 'usage-store.js');
      const usageMod = await import('file:///' + usageStorePath.replace(/\\/g, '/'));
      usageMod.recordUsage(projectDir, 'anthropic', 0, agentModelId || undefined);
    } catch (usageErr) {
      console.error('[forge-subagent] usage recording failed: ' + usageErr.message);
      // Non-fatal — proceed
    }
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
