'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, isForgeAgent, resolvePluginRoot, STDIN_TIMEOUT_SHORT, resolveRunId } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

function exitOk() {
  process.exit(0);
}

const { TERMINAL_STATUSES, readRunStatus } = require('./hook-utils');

async function main(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    exitOk();
    return;
  }

  const projectDir = resolveProjectDir(payload);

  // Resolve runId via the full precedence chain (env var → worktree-path →
  // dispatch-context file → findActiveRun). Fails open when no path resolves.
  const validRunId = await resolveRunId(projectDir, payload);
  if (!validRunId) {
    exitOk();
    return;
  }
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
  // Guard: ensure agents array exists on an otherwise valid run-active.json.
  if (!Array.isArray(data.agents)) {
    data.agents = [];
  }

  const agentId = payload.agent_id || null;
  const agentType = payload.agent_type || null;
  const normalizedType = agentType
    ? (agentType.startsWith('forge:') ? agentType.slice('forge:'.length) : agentType)
    : null;

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
      // INFO only — the hard-stop is enforced upstream by hooks/agent-loop-guard.js
      // (PreToolUse). If this fires, the guard either failed open or was bypassed.
      process.stderr.write(
        '[forge-stuck] INFO: Agent ' + safeType +
        ' dispatched ' + (priorCount + 1) + ' times in run ' + safeRunId +
        ' — stuck-loop guard should have blocked this upstream.\n'
      );
    }
  }

  // Agent allowlist check: if stages are present in run-active.json, warn when
  // this agent is not declared in any stage's agents array.
  // Warning-only — SubagentStart cannot block (no deny capability).
  // Fail-open: absent/null stages or stages with zero declared agents skip the check.
  if (data.stages != null && typeof data.stages === 'object' && normalizedType) {
    const allDeclaredAgents = new Set();
    for (const stageObj of Object.values(data.stages)) {
      if (stageObj && Array.isArray(stageObj.agents)) {
        for (const a of stageObj.agents) allDeclaredAgents.add(a);
      }
    }
    if (allDeclaredAgents.size > 0 && !allDeclaredAgents.has(normalizedType)) {
      const safeType = normalizedType.replace(/[\r\n]/g, ' ').trim();
      const safeRunId = (data.runId || '(unknown)').replace(/[\r\n]/g, ' ').trim();
      process.stderr.write(
        '[forge-allowlist] WARNING: Agent ' + safeType +
        ' is not declared in any stage for run ' + safeRunId +
        '. Declared agents: ' + [...allDeclaredAgents].join(', ') + '\n'
      );
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

  // Ensure the target directory exists before writing.
  // For per-run paths this is .pipeline/runs/<runId>/; for singleton it is .pipeline/.
  const targetDir = path.dirname(runActivePath);
  try {
    await fs.promises.mkdir(targetDir, { recursive: true });
  } catch (_) {
    // Directory already exists or creation failed — proceed to write attempt
  }

  try {
    const tmp = runActivePath + '.tmp.' + process.pid;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.promises.rename(tmp, runActivePath);
  } catch (err) {
    console.error('[forge-subagent] Failed to write run-active.json: ' + err.message);
    // Non-fatal — exit 0 regardless
  }

  // Dual-write stages status: set the matching stage to "running" when agent starts.
  // Fail-open: any error here must not block the hook.
  if (data.stages != null && data.runId) {
    try {
      const pluginRoot = resolvePluginRoot();
      const coreIndex = path.join(pluginRoot, 'packages', 'forge-core', 'src', 'runs', 'index.js');
      const coreMod = await import('file:///' + coreIndex.replace(/\\/g, '/'));
      const updateRun = coreMod.updateRun;

      // Find first stage whose agents array contains normalizedAgent.
      let matchedKey = null;
      for (const [key, stageObj] of Object.entries(data.stages)) {
        if (!stageObj || typeof stageObj !== 'object') continue;
        if (Array.isArray(stageObj.agents) && stageObj.agents.includes(normalizedAgent)) {
          matchedKey = key;
          break;
        }
      }

      if (matchedKey !== null) {
        const stage = data.stages[matchedKey];
        // Only advance to "running" from "pending" — no backward transitions.
        if (stage.status === 'pending') {
          updateRun(projectDir, data.runId, {
            stages: { [matchedKey]: { status: 'running' } },
          });
        }
      }
    } catch (stagesErr) {
      console.error('[forge-subagent] stages dual-write failed: ' + stagesErr.message);
      // Non-fatal — proceed
    }
  }

  // Sidecar: write forge-agent-session-<agentId>.json so the outer worker can
  // resolve agent_id → session_id when writing the ctx bridge file.
  // Only written when running inside a subagent process (payload.session_id present).
  // Atomic write (.tmp + rename) to prevent partial reads by the worker.
  const subagentSessionId = payload.session_id;
  if (agentId && subagentSessionId && /^[a-zA-Z0-9_-]+$/.test(subagentSessionId)) {
    const safeAgentId = String(agentId).replace(/[^a-zA-Z0-9_-]/g, '');
    const sidecarPath = path.join(os.tmpdir(), 'forge-agent-session-' + safeAgentId + '.json');
    const tmpPath = sidecarPath + '.tmp.' + process.pid;
    try {
      await fs.promises.writeFile(tmpPath, JSON.stringify({ sessionId: subagentSessionId }), 'utf8');
      await fs.promises.rename(tmpPath, sidecarPath);
    } catch (sidecarErr) {
      process.stderr.write('[forge-subagent] sidecar write failed: ' + sidecarErr.message + '\n');
      // Non-fatal — worker falls back silently when sidecar is absent
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
