'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const STDIN_TIMEOUT_MS = 5000;

function exitOk() {
  process.exit(0);
}

// -- FORGE agent allowlist ---------------------------------------------------
// See subagent-start.js for rationale. Duplicated here so both hooks filter
// symmetrically — a non-FORGE agent_type skipped at start must also skip at
// stop, so we never look for an entry that was never recorded.

let _forgeAgents = undefined;
function getForgeAgentSet() {
  if (_forgeAgents !== undefined) return _forgeAgents;
  try {
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
    const agentsDir = path.join(pluginRoot, 'agents');
    const entries = fs.readdirSync(agentsDir);
    const names = entries.filter(n => n.endsWith('.md')).map(n => n.slice(0, -3));
    if (names.length === 0) { _forgeAgents = null; return _forgeAgents; }
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
  if (!allowlist) return true; // fail open
  // Accept bare names ("planner") and namespaced names ("forge:planner").
  const normalized = agentType.startsWith('forge:') ? agentType.slice('forge:'.length) : agentType;
  return allowlist.has(normalized);
}

/**
 * Scans a string for the first `[reviewer-verdict] {...}` line.
 * Returns the `verdict` field value (e.g. "APPROVED", "BLOCK", "REVISE")
 * or null if no such line is found or the JSON is malformed.
 */
function extractVerdict(text) {
  if (!text || typeof text !== 'string') return null;
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

  // Resolve project directory: prefer cwd from payload, fall back to process.cwd()
  const projectDir = (payload.cwd && typeof payload.cwd === 'string' && payload.cwd.trim())
    ? payload.cwd.trim()
    : process.cwd();

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
    console.error('[forge-subagent] No matching entry for agent_id ' + agentId + ' — skipping stop patch');
    exitOk();
    return;
  }

  // Determine outcome from last_assistant_message
  const lastMessage = payload.last_assistant_message || null;
  const verdict = extractVerdict(lastMessage);
  const outcome = verdict !== null ? verdict : 'completed';

  // Patch entry in-place
  const completedAt = Date.now();
  entry.completedAt = completedAt;
  entry.durationMs = typeof entry.startedAt === 'number'
    ? completedAt - entry.startedAt
    : null;
  entry.outcome = outcome;

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
