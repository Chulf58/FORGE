'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

const CONDUCTOR_CONTEXT_BASE = [
  'FORGE conductor: this session is the control plane. It orchestrates pipelines and manages workflow.',
  '',
  'RULE: Do NOT use the Agent tool for ad-hoc work (no Explore, no general-purpose, no claude-code-guide). Use Read/Grep/Glob for quick lookups.',
  '',
  'PIPELINE SKILLS: /forge:plan, /forge:implement, /forge:debug, /forge:refactor, /forge:research, /forge:explore — these invoke agents as in-session subagents. This is expected and allowed. The skill handles run creation, model routing, and agent dispatch.',
  '',
  'DIRECT EDITING (only when user is actively iterating on small, immediate changes): edit files directly here.',
  '',
  'Gate approvals are conversational ("yes", "go", "approved").',
  'The observer TUI shows worker status — keep interruptions to one line.',
].join('\n');

function loadSolutionsIndex(projectDir) {
  try {
    const idxPath = path.join(projectDir, 'docs', 'solutions', 'index.json');
    const raw = fs.readFileSync(idxPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function formatSolutionsSummary(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const lines = ['KNOWLEDGE BASE (call forge_get_patterns for full content of any entry):'];
  for (const entry of entries) {
    const title = entry && typeof entry.title === 'string' ? entry.title : '(untitled)';
    const tags = Array.isArray(entry && entry.tags) ? entry.tags : [];
    const tagStr = tags.length > 0 ? ' [' + tags.join(', ') + ']' : '';
    lines.push('- ' + title + tagStr);
  }
  return lines.join('\n');
}

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { payload = {}; }

  const projectDir = resolveProjectDir(payload);

  // Orchestrator-dispatched agents inherit FORGE_WORKER_SESSION=1 from the worker
  // process (forge-worker.mjs:481) and load the full plugin, so this hook would
  // otherwise frame each agent as a conductor — they then comment instead of
  // coding and write nothing (run r-de1491f6). The env var is the reliable signal:
  // a worktree-local .worker-session marker is invisible here because
  // resolveProjectDir strips the .worktrees/r-<id> suffix and resolves to MAIN.
  if (process.env.FORGE_WORKER_SESSION === '1') { process.exit(0); return; }

  // Check durable worker marker (survives worker-task.json deletion by worker-task-inject.js)
  const workerSession = path.join(projectDir, '.pipeline', '.worker-session');
  const workerTask = path.join(projectDir, '.pipeline', 'worker-task.json');
  try { fs.accessSync(workerSession); process.exit(0); return; } catch (_) {}
  try { fs.accessSync(workerTask); process.exit(0); return; } catch (_) {}

  const summary = formatSolutionsSummary(loadSolutionsIndex(projectDir));
  const additionalContext = summary
    ? CONDUCTOR_CONTEXT_BASE + '\n\n' + summary
    : CONDUCTOR_CONTEXT_BASE;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  }) + '\n');

  process.exit(0);
}

module.exports = { loadSolutionsIndex, formatSolutionsSummary };

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
