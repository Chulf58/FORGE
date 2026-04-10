'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const STDIN_TIMEOUT_MS  = 10_000;
const MARKER_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

function exitOk() {
  process.exit(0);
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

async function isGuardEnabled() {
  try {
    const settingsPath = getSettingsPath();
    try {
      await fs.promises.access(settingsPath);
    } catch (_) {
      return false; // default: disabled if settings absent
    }
    const raw = await fs.promises.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(raw);
    return settings.workflowGuardEnabled === true;
  } catch (_) {
    return false; // default off on any error
  }
}

async function isPipelineActive() {
  const markerPath = path.join(process.cwd(), '.pipeline', 'run-active.json');
  try {
    await fs.promises.access(markerPath);
    const raw = await fs.promises.readFile(markerPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data.startedAt !== 'number') return false;
    // Stale marker (older than 5 minutes) or future timestamp (clock skew / corrupted JSON)
    // is treated as absent. The future-timestamp guard prevents a negative delta from
    // making the stale check permanently false when the system clock moves backwards.
    if (Date.now() - data.startedAt > MARKER_MAX_AGE_MS || data.startedAt > Date.now()) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function isSourceFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalised = filePath.replace(/\\/g, '/');
  // Must contain src/ or electron/ to be considered a source file
  const isSource = normalised.includes('/src/') || normalised.includes('/electron/');
  if (!isSource) return false;
  // Exclude docs, agent prompt files, template directory, and markdown files
  if (normalised.includes('/docs/')) return false;
  if (normalised.includes('/.claude/agents/')) return false;
  if (normalised.includes('/template/')) return false;
  if (normalised.endsWith('.md')) return false;
  return true;
}

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { exitOk(); return; }

  const toolName  = payload.tool_name;
  const toolInput = payload.tool_input || {};

  // Only act on Write and Edit
  if (toolName !== 'Write' && toolName !== 'Edit') { exitOk(); return; }

  // Extract file path — Write uses file_path, Edit uses file_path (confirmed by the main
  // process formatProgressLabel which reads input.file_path for both Write and Edit).
  // Fall back to path for robustness.
  const filePath = toolInput.file_path || toolInput.path || null;
  if (!filePath) { exitOk(); return; }

  // Opt-in check — off by default
  if (!(await isGuardEnabled())) { exitOk(); return; }

  // Pipeline active? No advisory needed.
  if (await isPipelineActive()) { exitOk(); return; }

  // Only warn for source files
  if (!isSourceFile(filePath)) { exitOk(); return; }

  // Emit advisory via additionalContext (injected directly into Claude's active session)
  const advisory =
    'Advisory: This edit is happening outside a FORGE pipeline run. ' +
    "Changes won't be tracked in a handoff, won't have a TESTING.md checklist, " +
    "and won't be reviewed. Consider using FORGE's debug: or implement feature: " +
    'pipeline instead. (This is advisory only \u2014 the edit will proceed.)';
  process.stdout.write(JSON.stringify({ additionalContext: advisory }) + '\n');

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
