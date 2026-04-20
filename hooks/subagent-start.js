'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, isForgeAgent } = require('./hook-utils');

const STDIN_TIMEOUT_MS = 5000;

function exitOk() {
  process.exit(0);
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'discarded']);

/**
 * Read the status of a run from the local registry at
 * .pipeline/runs/<runId>/run.json. Returns the status string or null when
 * the run file is absent, unreadable, unparseable, or missing a status.
 * Defensive — never throws.
 */
function readRunStatus(projectDir, runId) {
  if (!runId || typeof runId !== 'string') return null;
  try {
    const runPath = path.join(projectDir, '.pipeline', 'runs', runId, 'run.json');
    const raw = fs.readFileSync(runPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.status === 'string' ? parsed.status : null;
  } catch (_) {
    return null;
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

  const runActivePath = path.join(projectDir, '.pipeline', 'run-active.json');

  // Read existing run-active.json. Identity (runId / pipelineType / mode /
  // feature / startedAt) is owned exclusively by forge_create_run and
  // forge_resume_run — if run-active.json is missing or unparseable, there is
  // no authoritative pointer for this hook to amend, so exit silently rather
  // than scaffolding a partial identity-less file that poisons downstream
  // consumers (forge_get_active_run, statusline, workflow-guard).
  let data;
  try {
    const raw = await fs.promises.readFile(runActivePath, 'utf8');
    data = JSON.parse(raw);
  } catch (_) {
    exitOk();
    return;
  }
  // Guard: ensure agents array exists on an otherwise valid run-active.json.
  if (!Array.isArray(data.agents)) {
    data.agents = [];
  }

  const agentId = payload.agent_id || null;
  const agentType = payload.agent_type || null;

  if (!agentId) {
    // No agent_id — cannot track this entry meaningfully, exit silently
    exitOk();
    return;
  }

  // Filter: only record FORGE pipeline agents, not built-in Claude Code
  // subagents (general-purpose, Explore, Plan, claude-code-guide, etc.).
  // If allowlist resolution failed, isForgeAgent returns true (fail open).
  if (!isForgeAgent(agentType)) {
    exitOk();
    return;
  }

  // Terminal-run guard: if the run referenced by run-active.json is already
  // done (completed / failed / discarded), do not append to it — that would
  // re-animate a finished run and set a stale currentUnit. Fail-open: if
  // the registry is unreadable or the runId is absent, proceed as today.
  const runStatus = readRunStatus(projectDir, data.runId || null);
  if (runStatus && TERMINAL_STATUSES.has(runStatus)) {
    process.stderr.write('[forge-subagent] skipping append to terminal run ' + (data.runId || '(unknown)') + '\n');
    exitOk();
    return;
  }

  // Stuck-loop detection: count prior dispatches of this agent_type in the run.
  // Runs BEFORE the new entry is pushed, so priorCount reflects history only.
  // Fail-open: if data.agents is not an array or agentType is falsy, skip.
  if (Array.isArray(data.agents) && agentType) {
    const normalizedType = agentType.startsWith('forge:') ? agentType.slice('forge:'.length) : agentType;
    const priorCount = data.agents.filter((a) => {
      const t = a.agent_type || '';
      return (t.startsWith('forge:') ? t.slice('forge:'.length) : t) === normalizedType;
    }).length;

    const safeType = normalizedType.replace(/[\r\n]/g, ' ').trim();
    const safeRunId = (data.runId || '(unknown)').replace(/[\r\n]/g, ' ').trim();

    if (priorCount === 1) {
      process.stderr.write(
        '[forge-stuck] WARNING: Agent ' + safeType +
        ' dispatched a 2nd time in run ' + safeRunId +
        '. Allowing retry.\n'
      );
    } else if (priorCount >= 2) {
      const reason = '[forge-stuck] BLOCKED: Agent ' + safeType +
        ' dispatched ' + (priorCount + 1) + ' times in run ' + safeRunId +
        '. Stopping to prevent token burn.';
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: reason,
          },
        }) + '\n'
      );
      process.stderr.write(reason + '\n');
      process.exit(2);
    }
  }

  // Push new entry into agents array (mutate in-place)
  const nowTs = Date.now();
  data.agents.push({
    agent_id: agentId,
    agent_type: agentType,
    startedAt: nowTs,
  });

  // Report-only recovery primitive: mark this agent as the current in-flight
  // unit. SubagentStop clears it. If the session crashes mid-agent, this
  // marker survives on disk as a stale-lock signal for /forge:resume.
  // Strip the "forge:" namespace prefix so rendered output reads naturally
  // ("planner" rather than "forge:planner").
  const normalizedAgent = agentType && agentType.startsWith('forge:')
    ? agentType.slice('forge:'.length)
    : agentType;
  data.currentUnit = {
    agent: normalizedAgent,
    startedAt: nowTs,
  };

  // Ensure .pipeline directory exists before writing
  const pipelineDir = path.join(projectDir, '.pipeline');
  try {
    await fs.promises.mkdir(pipelineDir, { recursive: true });
  } catch (_) {
    // Directory already exists or creation failed — proceed to write attempt
  }

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
