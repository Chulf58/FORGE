'use strict';

const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
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

  // Synchronous invocation — detached spawn was unreliable on Windows
  // (process killed before completing the audit, producing zero audit-log
  // entries despite hundreds of SubagentStop events). The audit run is
  // <100ms in practice; blocking the hook is acceptable.
  try {
    execFileSync(process.execPath, [scriptPath, ...spawnArgs], {
      stdio: 'ignore',
      timeout: 5000,  // hard cap — defensive, audit should be far faster
      windowsHide: true,
    });
  } catch (err) {
    // Spawn errors, non-zero exit, or timeout — all non-fatal.
    // The audit chain is observability; never block the pipeline on its failure.
    process.stderr.write('[audit-trigger] audit failed: ' + err.message + '\n');
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
