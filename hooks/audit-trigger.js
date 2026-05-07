'use strict';

const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { resolveProjectDir, resolvePluginRoot, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

function exitOk() {
  process.exit(0);
}

function main(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    exitOk();
    return;
  }

  let projectDir;
  try {
    projectDir = resolveProjectDir(payload);
  } catch (_) {
    exitOk();
    return;
  }

  const pluginRoot = resolvePluginRoot();
  const scriptPath = path.join(pluginRoot, 'scripts', 'audit-tool-calls.mjs');

  const spawnArgs = ['--root', projectDir];

  // Pass session id when present in payload
  const sessionId = payload.session_id;
  if (sessionId && typeof sessionId === 'string' && /^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    spawnArgs.push('--session', sessionId);
  }

  try {
    const child = spawn('node', [scriptPath, ...spawnArgs], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (err) {
    // Spawn errors are non-fatal — log and continue
    process.stderr.write('[audit-trigger] spawn failed: ' + err.message + '\n');
  }

  // Always exit 0 immediately — fire-and-forget, never block the pipeline
  exitOk();
}

// -- Stdin reader with timeout guard -----------------------------------------
let inputData = '';
const timer = setTimeout(() => {
  main(inputData || '{}');
}, STDIN_TIMEOUT_MS);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => { inputData += line + '\n'; });
rl.on('close', () => {
  clearTimeout(timer);
  main(inputData || '{}');
});
