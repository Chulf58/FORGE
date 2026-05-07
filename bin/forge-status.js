#!/usr/bin/env node

// FORGE Status Line — project identity + truthful pipeline progress.
// Configured via Claude Code's statusLine setting.
//
// Derives display state from existing FORGE files only (no new state):
//   .pipeline/runs/index.json           — authoritative list of all runs
//   .pipeline/runs/<runId>/run.json     — full run state (stages, gateState)
//   .pipeline/run-active.json           — current session marker (fallback)
//   .pipeline/gate-pending.json         — pending gate state
//
// Design principle: this script and any future dashboard read the same
// source-of-truth files. No prompt-dependent bookkeeping.

const fs = require('fs');
const path = require('path');

// ─── Config ─────────────────────────────────────────────────────────────

const STALE_MS            = 30 * 60 * 1000; // 30 minutes
const MAX_VISIBLE_RUNS    = 2;              // before "+N more"
const BAR_CELLS           = 4;              // width of each progress bar

// ─── Pipeline stageLabel → progress stage mapping ───────────────────────
// Each entry maps stageLabel values to (stage, totalStages, label).
// Stage labels derived from run.stages via stageLabelFromStages().

const PIPELINE_STAGES = {
  plan: {
    icon: '🔍',
    totalStages: 5,
    label: 'planning',
    steps: {
      'planning':    { stage: 2, label: 'planning' },
      'reviewing':   { stage: 4, label: 'reviewers' },
    },
  },
  implement: {
    icon: '🔨',
    totalStages: 6,
    label: 'implementing',
    steps: {
      'implementing': { stage: 3, label: 'implementing' },
      'reviewing':    { stage: 5, label: 'reviewers' },
    },
  },
  apply: {
    icon: '🚀',
    totalStages: 4,
    label: 'applying',
    steps: {
      'applying':   { stage: 2, label: 'applying' },
    },
  },
  debug: {
    icon: '🐛',
    totalStages: 4,
    label: 'debugging',
    steps: {
      'debugging':  { stage: 2, label: 'debugging' },
      'reviewing':  { stage: 3, label: 'reviewers' },
    },
  },
  refactor: {
    icon: '♻️',
    totalStages: 4,
    label: 'refactoring',
    steps: {
      'refactoring': { stage: 2, label: 'refactoring' },
      'reviewing':   { stage: 3, label: 'reviewers' },
    },
  },
  research: {
    icon: '📚',
    totalStages: 2,
    label: 'researching',
    steps: {
      'researching': { stage: 2, label: 'researching' },
    },
  },
};

// ─── Stage label derivation (CJS inline — mirrors mcp/lib/stage-labels.js) ──

const STAGE_DISPLAY = {
  plan: 'planning', implement: 'implementing', review: 'reviewing',
  apply: 'applying', debug: 'debugging', refactor: 'refactoring', research: 'researching',
};

function stageLabelFromStages(stages) {
  if (!stages || typeof stages !== 'object') return null;
  for (const [key, val] of Object.entries(stages)) {
    if (val && val.status === 'running') return STAGE_DISPLAY[key] || key;
  }
  for (const [key, val] of Object.entries(stages)) {
    if (val && val.status === 'completed') return STAGE_DISPLAY[key] || key;
  }
  return null;
}

// ─── IO ─────────────────────────────────────────────────────────────────

const STDIN_TIMEOUT_MS = 500;

let input = '';
let rendered = false;
function finalize() {
  if (rendered) return;
  rendered = true;
  try {
    const meta = input ? JSON.parse(input) : {};
    const cwd = meta.cwd || process.cwd();
    process.stdout.write(render(cwd));
  } catch {
    // Fallback when stdin is malformed — still show something useful
    process.stdout.write('⚒  FORGE · ' + path.basename(process.cwd()) + ' · idle');
  }
  process.exit(0);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', finalize);

// Defensive: if Claude Code doesn't close stdin (some hosts keep it open),
// render with process.cwd() fallback after the timeout rather than hanging.
setTimeout(finalize, STDIN_TIMEOUT_MS);

// ─── Terminal status detection ──────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'discarded']);

// ─── Derivation: read state from source-of-truth files ──────────────────

function loadProjectState(projectDir) {
  const projectName = path.basename(projectDir);
  const now = Date.now();
  const activeRuns = [];

  // Primary source: run registry
  const indexPath = path.join(projectDir, '.pipeline', 'runs', 'index.json');
  if (fs.existsSync(indexPath)) {
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      // Status-aware staleness:
      // - gate-pending = legitimately waiting on a human; never filter by age
      //   (silence after 30 min would falsely report "no pending approval")
      // - running     = may be a dead pipeline that crashed mid-run; keep the
      //   stale cutoff so abandoned runs don't linger forever in the statusline
      // - completed with approved gate = waiting on user to advance; never stale
      const entries = (index.runs || [])
        .filter(e => e.status === 'running' || e.status === 'gate-pending' || e.status === 'completed')
        .filter(e => e.status === 'gate-pending' || e.status === 'completed' || !isStale(e.updatedAt, now))
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

      for (const entry of entries) {
        const run = readRun(projectDir, entry.runId);
        if (!run) continue;
        if (TERMINAL_STATUSES.has(run.status)) continue;
        activeRuns.push(run);
      }
    } catch {}
  }

  // Fallback: run-active.json — only when the registry didn't already decide.
  // Critical: run-active.json is a session-level pointer and can lag behind
  // the authoritative run registry. If the pointed run exists in the registry
  // with a terminal status (completed, discarded, failed), it is NOT active —
  // the registry is the source of truth and we must not re-synthesize it as
  // "running" just because the pointer file still names it.
  if (activeRuns.length === 0) {
    const runActivePath = path.join(projectDir, '.pipeline', 'run-active.json');
    if (fs.existsSync(runActivePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(runActivePath, 'utf8'));
        if (data.startedAt && (now - data.startedAt) < STALE_MS) {
          // If run-active.json names a run, consult the registry for its real status.
          // Only synthesize an active entry when the registry agrees it's active
          // (or doesn't know about the run at all — true fallback case).
          let canSynthesize = true;
          if (data.runId) {
            const registered = readRun(projectDir, data.runId);
            if (registered) {
              // Registry is authoritative. Render only if still active.
              canSynthesize = registered.status === 'running' || registered.status === 'gate-pending';
              if (canSynthesize) {
                // If registry has the run in an active state, use its truth
                // (includes real stageLabel, gateState) rather than synthesizing.
                activeRuns.push(registered);
                return { projectName, activeRuns };
              }
            }
          }
          if (canSynthesize) {
            activeRuns.push({
              runId: data.runId || 'r-?',
              pipelineType: data.pipelineType || 'implement',
              feature: data.feature || projectName,
              status: 'running',
              stageLabel: null,
              gateState: null,
            });
          }
        }
      } catch {}
    }
  }

  return { projectName, activeRuns };
}

function readRun(projectDir, runId) {
  const p = path.join(projectDir, '.pipeline', 'runs', runId, 'run.json');
  if (!fs.existsSync(p)) return null;
  try {
    const r = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (r === null || typeof r !== 'object') {
      return { runId, pipelineType: 'unknown', feature: '<unreadable>', status: 'running', stageLabel: null, gateState: null, degraded: true };
    }
    return {
      runId: r.runId,
      pipelineType: r.pipelineType,
      feature: r.feature || '',
      status: r.status,
      stageLabel: stageLabelFromStages(r.stages),
      gateState: r.gateState || null,
    };
  } catch {
    return { runId, pipelineType: 'unknown', feature: '<unreadable>', status: 'running', stageLabel: null, gateState: null, degraded: true };
  }
}

function isStale(isoString, now) {
  if (!isoString) return true;
  const t = Date.parse(isoString);
  if (isNaN(t)) return true;
  return (now - t) > STALE_MS;
}

// ─── Per-run rendering ──────────────────────────────────────────────────

function runToSegment(run) {
  const shortId = (run.runId || '').slice(0, 10);

  // Degraded sentinel — run.json exists but could not be parsed
  if (run.degraded === true) {
    return '⚠ ' + shortId + ' · state unreadable';
  }

  // Gate pending — highlight clearly
  if (run.status === 'gate-pending' && run.gateState) {
    const gate = run.gateState.gate;
    if (gate === 'gate1') {
      return `⏸  ${shortId} · plan approval needed`;
    }
    if (gate === 'gate2') {
      return `⏸  ${shortId} · implementation approval needed`;
    }
    return `⏸  ${shortId} · approval needed`;
  }

  // Active run — map stageLabel to progress stage
  const config = PIPELINE_STAGES[run.pipelineType];
  if (!config) {
    return `⚙  ${shortId} · ${run.pipelineType || 'running'}`;
  }

  const stepInfo = (run.stageLabel && config.steps[run.stageLabel])
    || { stage: 1, label: run.stageLabel || config.label };

  const bar = renderBar(stepInfo.stage, config.totalStages);
  return `${config.icon} ${shortId} ${bar} ${stepInfo.label}`;
}

function renderBar(filled, total) {
  const f = Math.min(Math.max(filled, 0), total);
  return '▓'.repeat(f) + '░'.repeat(Math.max(0, total - f));
}

// ─── Full status line ───────────────────────────────────────────────────

function render(projectDir) {
  const { projectName, activeRuns } = loadProjectState(projectDir);

  if (activeRuns.length === 0) {
    return `⚒  FORGE · ${projectName} · idle`;
  }

  const visible = activeRuns.slice(0, MAX_VISIBLE_RUNS);
  const overflow = activeRuns.length - visible.length;

  const segments = visible.map(runToSegment);
  if (overflow > 0) {
    segments.push(`+${overflow} more`);
  }

  return `⚒  ${projectName} · ` + segments.join(' │ ');
}
