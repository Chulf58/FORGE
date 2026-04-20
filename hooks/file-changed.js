'use strict';

// FileChanged hook — injects additionalContext when gate-pending.json or
// board.json change on disk, so Claude sees the updated pipeline state
// without needing an explicit read.
//
// Defensive on payload field name: Claude Code FileChanged payload field name
// was not confirmed in available documentation; the hook probes payload.file,
// payload.path, payload.filePath, and payload.file_path in order and uses
// the first non-empty string found. If none resolves, exits 0 silently.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir } = require('./hook-utils');

const STDIN_TIMEOUT_MS = 10000;

/**
 * Extract the changed file path from the payload using multiple candidate
 * field names, because the exact Claude Code FileChanged payload field is
 * not confirmed in documentation available at authoring time.
 *
 * @param {object} payload - parsed hook stdin payload
 * @returns {string} changed file path, or empty string if not found
 */
function resolveChangedFilePath(payload) {
  const candidates = ['file', 'path', 'filePath', 'file_path'];
  for (const key of candidates) {
    const val = payload[key];
    if (val && typeof val === 'string') return val;
  }
  return '';
}

async function main(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    process.exit(0);
    return;
  }

  const changedPath = resolveChangedFilePath(payload);
  if (!changedPath) {
    process.exit(0);
    return;
  }

  // Normalise to forward slashes for cross-platform suffix matching
  const normalised = changedPath.replace(/\\/g, '/');
  const isGatePending = normalised.endsWith('.pipeline/gate-pending.json');
  const isBoardJson = normalised.endsWith('.pipeline/board.json');

  if (!isGatePending && !isBoardJson) {
    process.exit(0);
    return;
  }

  const projectDir = resolveProjectDir(payload);
  let additionalContext = '';

  if (isGatePending) {
    try {
      const raw = await fs.promises.readFile(
        path.join(projectDir, '.pipeline', 'gate-pending.json'),
        'utf8',
      );
      const data = JSON.parse(raw);
      const gate = data.gate || 'unknown';
      const status = data.status || 'unknown';
      const feature = data.feature || 'unknown';
      additionalContext =
        '[FORGE] gate-pending.json changed: gate=' + gate +
        ' status=' + status +
        ' feature="' + feature + '".' +
        (status === 'approved'
          ? ' Gate is now approved — the next pipeline step may proceed.'
          : status === 'pending'
          ? ' Gate is pending — awaiting approval before the next step.'
          : '');
    } catch (_) {
      // File unreadable after change (e.g. deleted) — exit silently
      process.exit(0);
      return;
    }
  }

  if (isBoardJson) {
    additionalContext =
      '[FORGE] board.json changed externally — new TODOs or status changes ' +
      'may have been written. Use forge_read_board to see the current board state.';
  }

  if (additionalContext) {
    process.stdout.write(JSON.stringify({ additionalContext }));
  }

  process.exit(0);
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
