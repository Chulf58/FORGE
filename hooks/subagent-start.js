'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, resolvePluginRoot } = require('./hook-utils');

const STDIN_TIMEOUT_MS = 5000;

function exitOk() {
  process.exit(0);
}

// -- FORGE agent allowlist ---------------------------------------------------
// Derived from the plugin's agents/*.md filenames. Only events whose
// agent_type matches a known FORGE agent are recorded. Built-in Claude Code
// subagents (general-purpose, Explore, Plan, claude-code-guide, etc.) are
// skipped — they are session activity, not FORGE pipeline activity.
//
// Cached per process. On any failure resolving the list, returns null and
// the caller falls back to pre-change behavior (record everything).

let _forgeAgents = undefined; // undefined = not yet probed; null = failed; Set = ok
function getForgeAgentSet() {
  if (_forgeAgents !== undefined) return _forgeAgents;
  try {
    const pluginRoot = resolvePluginRoot();
    const agentsDir = path.join(pluginRoot, 'agents');
    const entries = fs.readdirSync(agentsDir);
    const names = entries
      .filter(n => n.endsWith('.md'))
      .map(n => n.slice(0, -3)); // strip .md
    if (names.length === 0) {
      _forgeAgents = null; // empty dir — fail open
      return _forgeAgents;
    }
    _forgeAgents = new Set(names);
    return _forgeAgents;
  } catch (_) {
    _forgeAgents = null;
    return _forgeAgents;
  }
}

function isForgeAgent(agentType) {
  if (!agentType) return false;
  const allowlist = getForgeAgentSet();
  if (!allowlist) return true; // allowlist unavailable → fail open (record all)
  // Accept bare names ("planner") and namespaced names ("forge:planner").
  // The allowlist is built from bare filenames — normalize before lookup.
  const normalized = agentType.startsWith('forge:') ? agentType.slice('forge:'.length) : agentType;
  return allowlist.has(normalized);
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
