'use strict';

// Stop hook — advisory reminders when pipeline work appears incomplete.
// Never blocks (exit 0 always). Outputs additionalContext when conditions are met.
// Staleness guard: warnings suppressed if data is older than 30 minutes.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir } = require('./hook-utils');

const STDIN_TIMEOUT_MS = 10000;
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function exitWithContext(additionalContext) {
  if (additionalContext) {
    process.stdout.write(JSON.stringify({ additionalContext }));
  }
  process.exit(0);
}

async function main(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    payload = {};
  }

  const projectDir = resolveProjectDir(payload);

  const pipelineDir = path.join(projectDir, '.pipeline');
  const now = Date.now();
  const warnings = [];

  // Check 1: Incomplete pipeline run
  try {
    const raw = await fs.promises.readFile(path.join(pipelineDir, 'run-active.json'), 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.agents)) {
      const incomplete = data.agents.filter(a => a.startedAt && !a.completedAt);
      // Staleness guard: skip if oldest incomplete agent started > 30 min ago
      const isFresh = incomplete.some(a => (now - a.startedAt) < STALE_THRESHOLD_MS);
      if (incomplete.length > 0 && isFresh) {
        warnings.push('Pipeline run has ' + incomplete.length + ' agent(s) that started but did not complete.');
      }
    }
  } catch (_) { /* file missing or unreadable — skip */ }

  // Check 2: Pending gate
  try {
    const raw = await fs.promises.readFile(path.join(pipelineDir, 'gate-pending.json'), 'utf8');
    const data = JSON.parse(raw);
    if (data.status === 'pending') {
      // Staleness guard: skip if gate has no recent timestamp
      const gateTime = data.createdAt ? new Date(data.createdAt).getTime() : 0;
      const isFresh = gateTime > 0 ? (now - gateTime) < STALE_THRESHOLD_MS : true;
      if (isFresh) {
        warnings.push('Gate ' + (data.gate || '?') + ' is pending approval for "' + (data.feature || 'unknown') + '".');
      }
    }
  } catch (_) { /* file missing or unreadable — skip */ }

  // Check 3: Documenter not run
  try {
    const raw = await fs.promises.readFile(path.join(pipelineDir, 'run-active.json'), 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.agents) && data.agents.length > 0) {
      const hasDocumenter = data.agents.some(a => a.agent_type === 'forge:documenter' && a.completedAt);
      const hasImplementer = data.agents.some(a => a.agent_type === 'forge:implementer' && a.completedAt);
      if (hasImplementer && !hasDocumenter) {
        warnings.push('Source files were modified (implementer ran) but the documenter agent has not run. Run the documenter before ending the session.');
      }
    }
  } catch (_) { /* file missing or unreadable — skip */ }

  // Check 4: Unapplied handoff
  try {
    const handoffPath = path.join(projectDir, 'docs', 'context', 'handoff.md');
    const stat = await fs.promises.stat(handoffPath);
    // Staleness guard: skip if file was last modified > 30 min ago
    const isFresh = (now - stat.mtimeMs) < STALE_THRESHOLD_MS;
    if (stat.size > 100 && isFresh) {
      warnings.push('A handoff document exists with recent content — verify it has been applied.');
    }
  } catch (_) { /* file missing — skip */ }

  if (warnings.length === 0) {
    exitWithContext('');
    return;
  }

  const message = 'FORGE pipeline check:\n- ' + warnings.join('\n- ');
  exitWithContext(message);
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
