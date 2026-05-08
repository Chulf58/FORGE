'use strict';

// SessionEnd hook — advisory reminder when end-of-session protocol appears incomplete.
// Never blocks (exit 0 always). Emits stderr reminder when source-modifying agents
// ran but handoff.md or CHANGELOG.md are stale (older than 60 minutes).

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_LONG, findActiveRun } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_LONG;
const FRESHNESS_MS = 60 * 60 * 1000; // 60 minutes

async function main(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    process.exit(0);
    return;
  }

  const projectDir = resolveProjectDir(payload);

  // Check sessionEndReminder opt-out in project.json
  try {
    const projRaw = await fs.promises.readFile(
      path.join(projectDir, '.pipeline', 'project.json'),
      'utf8',
    );
    const projData = JSON.parse(projRaw);
    if (projData.sessionEndReminder === false) {
      process.exit(0);
      return;
    }
  } catch (_) { /* missing or unreadable — default to enabled */ }

  // Check whether any source-modifying agents (implementer or coder) completed.
  // Resolve the active run via the registry-based helper, then read its per-run
  // active file. When no unique non-terminal run exists, the check is skipped
  // (same fail-open as the prior singleton-missing path).
  let sourceAgentRan = false;
  try {
    const active = await findActiveRun(projectDir);
    if (active && active.runId) {
      const activeRaw = await fs.promises.readFile(
        path.join(projectDir, '.pipeline', 'runs', active.runId, 'run-active.json'),
        'utf8',
      );
      const activeData = JSON.parse(activeRaw);
      if (Array.isArray(activeData.agents)) {
        sourceAgentRan = activeData.agents.some((a) => {
          const t = typeof a.agent_type === 'string' ? a.agent_type : '';
          return t.includes('coder') && a.completedAt;
        });
      }
    }
  } catch (_) { /* per-run active file absent or unreadable — skip check */ }

  if (!sourceAgentRan) {
    process.exit(0);
    return;
  }

  const now = Date.now();
  const stale = [];

  // Check handoff.md freshness
  try {
    const stat = await fs.promises.stat(
      path.join(projectDir, 'docs', 'context', 'handoff.md'),
    );
    if ((now - stat.mtimeMs) > FRESHNESS_MS) {
      stale.push('docs/context/handoff.md');
    }
  } catch (_) {
    stale.push('docs/context/handoff.md (missing)');
  }

  // Check CHANGELOG.md freshness
  try {
    const stat = await fs.promises.stat(
      path.join(projectDir, 'docs', 'CHANGELOG.md'),
    );
    if ((now - stat.mtimeMs) > FRESHNESS_MS) {
      stale.push('docs/CHANGELOG.md');
    }
  } catch (_) {
    stale.push('docs/CHANGELOG.md (missing)');
  }

  if (stale.length > 0) {
    process.stderr.write(
      '[forge-session-end] End-of-session protocol reminder: source-modifying agent ran ' +
      'but the following files appear stale (>60 min): ' + stale.join(', ') + '. ' +
      'Run the documenter agent and update CHANGELOG before closing.\n',
    );
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
