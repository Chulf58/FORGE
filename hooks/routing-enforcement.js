'use strict';

// PreToolUse hook: enforce mandatory routing for FORGE pipeline agents.
//
// Blocks Agent spawns for known pipeline agents unless forge_get_model_recommendation
// was called for that agent in the current session. Skills are markdown — this hook
// converts the documented "mandatory routing" pattern into a mechanical control.
//
// Contract:
//   - tool_name !== 'Agent'                          → allow (pass through)
//   - tool_input.subagent_type not a pipeline agent  → allow (generic Agent use)
//   - log has entry for agent within TTL             → allow
//   - otherwise                                      → block (exit 2, deny envelope)
//
// Log is written by mcp/server.js inside the forge_get_model_recommendation handler
// and cleared at session start by hooks/routing-log-clear.js.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolvePluginRoot } = require('./hook-utils');

const STDIN_TIMEOUT_MS = 10_000;
const RECOMMENDATION_TTL_MS = 15 * 60 * 1000; // 15 minutes — complex pipelines with multiple researchers can exceed 5 min

const LOG_RELATIVE_PATH = path.join('.pipeline', 'session-dispatch-log.json');

// Dynamically derived from agents/*.md on first call.
// undefined = not yet probed; null = failed (fail-open); Set = ok
let _pipelineAgents = undefined;

function getPipelineAgentSet() {
  if (_pipelineAgents !== undefined) return _pipelineAgents;
  try {
    const agentsDir = path.join(resolvePluginRoot(), 'agents');
    const entries = fs.readdirSync(agentsDir);
    const names = entries
      .filter(n => n.endsWith('.md'))
      .map(n => n.slice(0, -3)); // strip .md
    if (names.length === 0) {
      _pipelineAgents = null; // empty dir — fail open
      return _pipelineAgents;
    }
    _pipelineAgents = new Set(names);
    return _pipelineAgents;
  } catch (_) {
    _pipelineAgents = null;
    return _pipelineAgents;
  }
}

function isPipelineAgent(name) {
  const set = getPipelineAgentSet();
  if (!set) return true; // allowlist unavailable → fail open (enforce on all)
  return set.has(name);
}

function exitOk() { process.exit(0); }

function exitBlock(msg) {
  // PreToolUse deny envelope — honored by the Claude Code validator.
  // Keep stderr + exit 2 as a belt-and-suspenders fallback (see workflow-guard.js).
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: msg,
      },
    }) + '\n'
  );
  console.error(msg);
  process.exit(2);
}

function readDispatchLog(projectDir) {
  const logPath = path.join(projectDir, LOG_RELATIVE_PATH);
  let raw;
  try {
    raw = fs.readFileSync(logPath, 'utf8');
  } catch (_) {
    return []; // no log yet or unreadable — treat as empty
  }
  try {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.entries)) return [];
    return data.entries;
  } catch (_) {
    return []; // malformed — treat as empty (hook will block)
  }
}

function hasValidRecommendation(entries, agentName, now) {
  for (const e of entries) {
    if (!e || e.agentName !== agentName) continue;
    const ts = typeof e.ts === 'number' ? e.ts : 0;
    // Reject future timestamps (clock skew / tampering) and expired ones.
    if (ts <= now && now - ts <= RECOMMENDATION_TTL_MS) return true;
  }
  return false;
}

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { exitOk(); return; }

  if (payload.tool_name !== 'Agent') { exitOk(); return; }

  const subagentType = payload.tool_input && payload.tool_input.subagent_type;
  if (!subagentType || typeof subagentType !== 'string') { exitOk(); return; }

  // Not a FORGE pipeline agent — enforcement does not apply.
  if (!isPipelineAgent(subagentType)) { exitOk(); return; }

  const projectDir = process.cwd();
  const entries = readDispatchLog(projectDir);
  const now = Date.now();

  if (hasValidRecommendation(entries, subagentType, now)) {
    exitOk();
    return;
  }

  exitBlock(
    'FORGE: Cannot spawn pipeline agent "' + subagentType + '" without first ' +
    'calling forge_get_model_recommendation for it. Skills must route through ' +
    'the recommendation system — see docs/gotchas/GENERAL.md "Skill orchestration ' +
    'routing pattern". If this was invoked deliberately outside a skill, call ' +
    'forge_get_model_recommendation(agentName="' + subagentType + '") first and ' +
    'retry within 5 minutes.'
  );
}

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
