'use strict';

// worker-task-inject.js — SessionStart hook
// Reads .pipeline/worker-task.json (written by forge_create_run MCP tool) and injects
// the task context so the worker session knows what to do on first prompt.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, resolvePluginRoot, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

// Resolve the main project directory from a worktree path.
// If projectDir is a worktree, returns the parent project root; otherwise returns projectDir as-is.
function findMainProjectDir(projectDir) {
  const gitFile = path.join(projectDir, '.git');
  try {
    const content = fs.readFileSync(gitFile, 'utf8').trim();
    if (content.startsWith('gitdir:')) {
      const gitdir = content.replace('gitdir:', '').trim();
      const match = gitdir.match(/(.+)[/\\]\.git[/\\]worktrees[/\\]/);
      if (match) return match[1];
    }
  } catch (_) {}
  return projectDir;
}

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

function findWorkerTaskFile(dir) {
  const runId = process.env.FORGE_WORKER_RUN_ID;
  if (runId) {
    // Targeted: use cwd directly (not resolveProjectDir) so worktree workers
    // find their file in <worktreePath>/.pipeline/ rather than the stripped
    // main project root.
    const pipelineDir = path.join(process.cwd(), '.pipeline');
    const specific = 'worker-task-' + runId + '.json';
    try {
      const entries = fs.readdirSync(pipelineDir);
      return entries.includes(specific) ? path.join(pipelineDir, specific) : null;
    } catch (_) {
      return null;
    }
  }
  // Fallback: no runId env var — lex-first (conductor sessions, legacy, tests)
  const pipelineDir = path.join(dir, '.pipeline');
  try {
    const entries = fs.readdirSync(pipelineDir);
    const match = entries.find((e) => /^worker-task-.+\.json$/.test(e));
    return match ? path.join(pipelineDir, match) : null;
  } catch (_) {
    return null;
  }
}

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { payload = {}; }

  const projectDir = resolveProjectDir(payload);
  const taskPath = findWorkerTaskFile(projectDir);

  if (!taskPath) {
    process.exit(0);
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  } catch (_) {
    process.exit(0);
    return;
  }

  process.stderr.write('[worker-task] injecting task for run ' + (data.runId || '?') + '\n');

  const safe = (s) => String(s || '?').replace(/[\r\n]/g, ' ').trim();
  const pType = safe(data.pipelineType || 'plan');
  const feat = safe(data.feature);
  const runId = safe(data.runId);
  const lines = [];
  lines.push('You are a FORGE worker session spawned to execute a pipeline task.');
  lines.push('');
  lines.push('Run: ' + runId);
  lines.push('Feature: ' + feat);
  lines.push('Pipeline: ' + pType);
  lines.push('');

  // These pipeline types do their work directly — do NOT call the slash command
  // (that would spawn another worker, causing an infinite loop).
  const directWork = new Set(['research', 'explore']);
  if (directWork.has(pType)) {
    lines.push('You are a research worker. Do the research directly — do NOT call /forge:research or forge_create_run with spawnWorker.');
    lines.push('');
    lines.push('Research topic: ' + feat);
    lines.push('');
    lines.push('Steps:');
    lines.push('1. Read docs/gotchas/GENERAL.md for project context');
    lines.push('2. Use Read, Grep, Glob, WebSearch, WebFetch to investigate');
    lines.push('3. Write findings to docs/RESEARCH/<topic-slug>.md');
    lines.push('4. When done, call forge_update_run({ runId: "' + runId + '", status: "completed" })');
  } else {
    // Inject only the worker-relevant steps from the skill file.
    // Skill files contain a conductor-only Step 1 (dispatch worker) followed by an
    // HTML comment marker, then worker-only steps. Stripping the conductor section
    // prevents workers from seeing and re-executing Step 1 (infinite-loop hazard).
    const VALID_PIPELINE_TYPES = new Set(['plan', 'implement', 'apply', 'debug', 'refactor', 'research', 'explore', 'ideate']);
    let workerStepsInjected = false;
    try {
      if (!VALID_PIPELINE_TYPES.has(pType)) throw new Error('invalid pType');
      const pluginRoot = resolvePluginRoot();
      const skillPath = path.join(pluginRoot, 'skills', pType, 'SKILL.md');
      const skillContent = fs.readFileSync(skillPath, 'utf8');
      // All split-capable skill files contain a comment of the form:
      //   <!-- Step(s) N... below are executed by the autonomous worker process. ... -->
      // Everything after this comment's closing --> is the worker-only content.
      const splitIdx = skillContent.indexOf('<!-- Step');
      if (splitIdx !== -1) {
        const closeIdx = skillContent.indexOf('-->', splitIdx);
        if (closeIdx !== -1) {
          let workerContent = skillContent.slice(closeIdx + 3).trim();
          workerContent = workerContent.replace(/\$ARGUMENTS/g, feat);
          if (workerContent.length > 0) {
            lines.push(workerContent);
            workerStepsInjected = true;
          }
        }
      }
    } catch (_) {
      // Fail-open: skill file unreadable — fall through to legacy invocation
    }
    if (!workerStepsInjected) {
      // Fallback: legacy skill invocation with an explicit skip instruction.
      lines.push('When the user types their first message (even just "go"), execute:');
      lines.push('  /forge:' + pType + ' ' + feat);
      lines.push('');
      lines.push('IMPORTANT: The run has already been created and the worker has been spawned. Skip STEP 1 (dispatch worker) — start from STEP 2.');
    }
  }

  // Append stages block when available: read from run registry (worker-task.json does not carry stages).
  if (data.runId) {
    try {
      const pluginRoot = resolvePluginRoot();
      const coreIndex = path.join(pluginRoot, 'packages', 'forge-core', 'src', 'runs', 'index.js');
      const coreMod = await import('file:///' + coreIndex.replace(/\\/g, '/'));
      const run = coreMod.getRun(resolveProjectDir(payload), data.runId);
      if (run && run.stages != null && typeof run.stages === 'object' && Object.keys(run.stages).length > 0) {
        const stageParts = Object.entries(run.stages).map(([k, v]) => {
          const name = safe(k);
          const agentsStr = Array.isArray(v && v.agents) ? v.agents.map(a => safe(a)).join(', ') : '';
          const status = safe(v && v.status ? v.status : 'unknown');
          return name + ' [' + status + ']' + (agentsStr ? ' agents: ' + agentsStr : '');
        });
        lines.push('');
        lines.push('Stages:');
        for (const sp of stageParts) lines.push('  ' + sp);
      }
    } catch (_) {
      // Fail-open: stages unavailable — do not append, proceed normally
    }
  }

  // Append CLAUDE-WORKER.md instructions so the worker session loads worker-specific rules
  let workerInstructions = '';
  try {
    const pluginRoot = resolvePluginRoot();
    const workerMdPath = path.join(pluginRoot, 'CLAUDE-WORKER.md');
    workerInstructions = '\n\n' + fs.readFileSync(workerMdPath, 'utf8');
  } catch (_) {
    process.stderr.write('[worker-task] CLAUDE-WORKER.md not found or unreadable — continuing without worker instructions\n');
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: lines.join('\n') + workerInstructions,
    },
  }) + '\n');

  // Delete AFTER stdout write — if we crash between delete and write, task context is lost
  try { fs.unlinkSync(taskPath); } catch (_) {}

  // Mark this session as a worker so other hooks (worker-done-inject) can skip it
  try {
    const markerPath = path.join(projectDir, '.pipeline', '.worker-session');
    fs.writeFileSync(markerPath, JSON.stringify({ runId: data.runId, since: new Date().toISOString() }) + '\n', 'utf8');
  } catch (_) {}

  // Write an initial heartbeat so the observer has a reference point even if
  // this worker crashes before completing any tool call. PostToolUse
  // (worker-heartbeat.js) will refresh this on every subsequent tool use.
  try {
    const mainDir = findMainProjectDir(projectDir);
    const hbDir = path.join(mainDir, '.pipeline', 'heartbeats');
    fs.mkdirSync(hbDir, { recursive: true });
    const hbFile = path.join(hbDir, data.runId + '.json');
    const tmpFile = hbFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify({ runId: data.runId, timestamp: Date.now() }) + '\n', 'utf8');
    fs.renameSync(tmpFile, hbFile);
  } catch (_) {}

  process.exit(0);
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
