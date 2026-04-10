'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const STDIN_TIMEOUT_MS    = 10_000;
const BRIDGE_TTL_MS       = 60_000;
const DEBOUNCE_CALL_COUNT = 5;
const THRESHOLD_WARNING   = 35;
const THRESHOLD_CRITICAL  = 25;

function exitOk() {
  process.exit(0);
}

function logToolCall(payload) {
  const sessionId = payload.session_id;
  if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) return;

  // Sanitise tool_input: shallow-copy then delete large-payload fields
  const rawInput = payload.tool_input || {};
  const sanitisedInput = Object.assign({}, rawInput);
  delete sanitisedInput.content;
  delete sanitisedInput.old_string;
  delete sanitisedInput.new_string;
  delete sanitisedInput.notebook_content;

  // Truncate any remaining string values to 200 characters
  for (const key of Object.keys(sanitisedInput)) {
    if (typeof sanitisedInput[key] === 'string' && sanitisedInput[key].length > 200) {
      sanitisedInput[key] = sanitisedInput[key].slice(0, 200);
    }
  }

  const entry = {
    tool_name:  payload.tool_name,
    tool_input: sanitisedInput,
    // agent_type is present only when the hook fires inside a subagent.
    // Falls back to 'orchestrator' so audit consumers never see undefined.
    agent_type: payload.agent_type || 'orchestrator',
    timestamp:  Date.now(),
  };

  const auditPath  = path.join(os.tmpdir(), 'claude-audit-' + sessionId + '.jsonl');
  const latestPath = path.join(os.tmpdir(), 'claude-audit-latest.txt');

  // Fire-and-forget — a failed log entry is non-fatal
  fs.promises.appendFile(auditPath, JSON.stringify(entry) + '\n', 'utf8').catch(() => {});
  // Write bare sessionId string — no JSON wrapper, no trailing newline
  fs.promises.writeFile(latestPath, sessionId, 'utf8').catch(() => {});
}

function getSettingsPath() {
  // Matches Electron app.getPath('userData'): %APPDATA%\FORGE on Windows
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'FORGE', 'forge-settings.json');
  }
  // macOS: ~/Library/Application Support/FORGE
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'FORGE', 'forge-settings.json');
  }
  // Linux: ~/.config/FORGE
  return path.join(os.homedir(), '.config', 'FORGE', 'forge-settings.json');
}

async function isWarningsEnabled() {
  try {
    const settingsPath = getSettingsPath();
    try {
      await fs.promises.access(settingsPath);
    } catch (_) {
      return true; // default: enabled if file absent
    }
    const raw = await fs.promises.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(raw);
    if (settings.contextWarningsEnabled === false) return false;
  } catch (_) {
    // Default to enabled on any read/parse error
  }
  return true;
}

async function readBridge(sessionId) {
  const bridgePath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
  try {
    await fs.promises.access(bridgePath);
    const raw = await fs.promises.readFile(bridgePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data.timestamp !== 'number') return null;
    if (Date.now() - data.timestamp > BRIDGE_TTL_MS) return null; // stale
    return data;
  } catch (_) {
    return null;
  }
}

async function readDebounce(sessionId) {
  const debouncePath = path.join(os.tmpdir(), `claude-ctx-debounce-${sessionId}.json`);
  try {
    await fs.promises.access(debouncePath);
    const raw = await fs.promises.readFile(debouncePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return { callCount: 0, lastSeverity: null, lastCallCount: 0 };
  }
}

function writeDebounce(sessionId, state) {
  const debouncePath = path.join(os.tmpdir(), `claude-ctx-debounce-${sessionId}.json`);
  // Fire-and-forget write — non-fatal if it fails; next call re-evaluates from stale/zero state
  fs.promises.writeFile(debouncePath, JSON.stringify(state), 'utf8').catch(() => {});
}

function getSeverity(remaining) {
  if (remaining <= THRESHOLD_CRITICAL) return 'critical';
  if (remaining <= THRESHOLD_WARNING)  return 'warning';
  return null;
}

function buildAdvisory(severity, pct) {
  const rounded = Math.round(pct);
  if (severity === 'critical') {
    return `Context window is critically low (~${rounded}% remaining). Stop this run and start a new conversation immediately to prevent output truncation.`;
  }
  return `Context window is running low (~${rounded}% remaining). Consider saving your work and starting a new conversation soon to avoid truncated output.`;
}

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { exitOk(); return; }

  // Log every tool call (including Agent) before any early exits
  logToolCall(payload);

  // Skip Agent tool completions for context monitoring — additionalContext is not supported
  // for Agent PostToolUse events and context monitoring is irrelevant for subagent spawns.
  if (payload.tool_name === 'Agent') { exitOk(); return; }

  const sessionId = payload.session_id;
  if (!sessionId) { exitOk(); return; }

  // Opt-out check: read FORGE settings before doing anything else
  if (!(await isWarningsEnabled())) { exitOk(); return; }

  // Read bridge file — exit silently if absent or stale
  const bridge = await readBridge(sessionId);
  if (!bridge) { exitOk(); return; }

  const { remaining } = bridge;
  const severity = getSeverity(remaining);

  // No threshold crossed — nothing to emit
  if (!severity) { exitOk(); return; }

  // Read debounce state
  const debounce      = await readDebounce(sessionId);
  const newCallCount  = (debounce.callCount || 0) + 1;

  // Suppress only if the exact same severity fired within the last DEBOUNCE_CALL_COUNT calls.
  // Any change in severity (escalation OR improvement) always fires immediately.
  const callsSinceLast = newCallCount - (debounce.lastCallCount || 0);
  const isSameOrLower  = debounce.lastSeverity === severity;
  const shouldSuppress = isSameOrLower && callsSinceLast < DEBOUNCE_CALL_COUNT;

  if (shouldSuppress) {
    writeDebounce(sessionId, {
      callCount: newCallCount,
      lastSeverity: debounce.lastSeverity,
      lastCallCount: debounce.lastCallCount || 0,
    });
    exitOk();
    return;
  }

  // Threshold crossed and not suppressed — emit advisory and update debounce
  writeDebounce(sessionId, {
    callCount: newCallCount,
    lastSeverity: severity,
    lastCallCount: newCallCount,
  });

  const advisory = buildAdvisory(severity, remaining);
  // Validate sessionId format before using it in a filename — prevents path injection.
  // Pattern mirrors the startsWith() guard used in src/main/index.ts agent IPC handlers.
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    exitOk();
    return;
  }
  // Write advisory to a temp file for FORGE to pick up (optional — for future use)
  const advisoryPath = path.join(os.tmpdir(), `claude-ctx-advisory-${sessionId}.json`);
  fs.promises.writeFile(advisoryPath, JSON.stringify({ advisory, severity, timestamp: Date.now() }), 'utf8').catch(() => {});
  // Emit checkpoint signal to stdout — valid for PostToolUse, consumed by FORGE's onStdout handler
  process.stdout.write('[CONTEXT-CHECKPOINT]\n');

  exitOk();
}

// Read stdin with timeout guard
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
