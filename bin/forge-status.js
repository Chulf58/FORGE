#!/usr/bin/env node

// FORGE Status Line — project identity + truthful pipeline progress.
// Configured via Claude Code's statusLine setting.
//
// Derives display state from existing FORGE files only (no new state):
//   .pipeline/runs/index.json           — authoritative list of all runs
//   .pipeline/runs/<runId>/run.json     — full run state (currentStep, gateState)
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

// ─── Pipeline step → progress stage mapping ─────────────────────────────
// Each entry maps currentStep substrings to (stage, totalStages, label).
// Step names from forge_update_run / skill orchestration.

const PIPELINE_STAGES = {
  plan: {
    icon: '🔍',
    totalStages: 5,
    label: 'planning',
    steps: {
      'started':                 { stage: 1, label: 'starting' },
      'brainstormer-decision':   { stage: 1, label: 'brainstorming' },
      'planner':                 { stage: 2, label: 'planner' },
      'researcher':              { stage: 3, label: 'researcher' },
      'gotcha-checker':          { stage: 3, label: 'gotcha-check' },
      'reviewer-triage':         { stage: 4, label: 'reviewers' },
      'reviewer-boundary':       { stage: 4, label: 'reviewers' },
      'gate1':                   { stage: 5, label: 'gate1' },
    },
  },
  implement: {
    icon: '🔨',
    totalStages: 6,
    label: 'implementing',
    steps: {
      'started':                 { stage: 1, label: 'starting' },
      'setup':                   { stage: 1, label: 'setup' },
      'implementation-architect':{ stage: 2, label: 'scoping slice' },
      'coder-scout':             { stage: 3, label: 'scout' },
      'coder':                   { stage: 3, label: 'coder' },
      'completeness-checker':    { stage: 4, label: 'completeness' },
      'reviewer-triage':         { stage: 5, label: 'reviewers' },
      'reviewer-boundary':       { stage: 5, label: 'reviewers' },
      'gate2':                   { stage: 6, label: 'gate2' },
    },
  },
  apply: {
    icon: '🚀',
    totalStages: 6,
    label: 'applying',
    steps: {
      'started':                 { stage: 1, label: 'starting' },
      'setup':                   { stage: 1, label: 'setup' },
      'implementer-triage':      { stage: 2, label: 'triage' },
      'implementer':             { stage: 2, label: 'implementer' },
      'testing':                 { stage: 3, label: 'tests' },
      'documenter':              { stage: 4, label: 'documenter' },
      'worktree-commit':         { stage: 5, label: 'wt-commit' },
      'merge-back':              { stage: 6, label: 'merge-back' },
      'done':                    { stage: 6, label: 'done' },
    },
  },
  debug: {
    icon: '🐛',
    totalStages: 4,
    label: 'debugging',
    steps: {
      'started':                 { stage: 1, label: 'starting' },
      'debug':                   { stage: 2, label: 'tracing' },
      'reviewer-triage':         { stage: 3, label: 'reviewers' },
      'reviewer-boundary':       { stage: 3, label: 'reviewers' },
      'gate2':                   { stage: 4, label: 'gate2' },
    },
  },
  refactor: {
    icon: '♻️',
    totalStages: 4,
    label: 'refactoring',
    steps: {
      'started':                 { stage: 1, label: 'starting' },
      'refactor':                { stage: 2, label: 'analyzing' },
      'reviewer-triage':         { stage: 3, label: 'reviewers' },
      'reviewer-boundary':       { stage: 3, label: 'reviewers' },
      'gate2':                   { stage: 4, label: 'gate2' },
    },
  },
};

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

// ─── "Requires attention" detection ─────────────────────────────────────
// A completed run with an approved gate still needs the user to advance it
// to the next pipeline step. These are not truly terminal.

const NEXT_STEP_MAP = {
  plan:      { gate: 'gate1', next: '/forge:implement' },
  implement: { gate: 'gate2', next: '/forge:apply' },
  debug:     { gate: 'gate2', next: '/forge:apply' },
  refactor:  { gate: 'gate2', next: '/forge:apply' },
};

function needsNextStep(run) {
  if (run.status !== 'completed') return null;
  const mapping = NEXT_STEP_MAP[run.pipelineType];
  if (!mapping) return null;
  const gs = run.gateState;
  if (gs && gs.gate === mapping.gate && gs.status === 'approved') return mapping.next;
  return null;
}

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

      // Only the latest run per feature can need attention. Earlier runs in
      // the same chain are superseded regardless of gate state.
      const latestByFeature = new Map();
      const fullIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      for (const e of (fullIndex.runs || [])) {
        const key = (e.feature || '').toLowerCase();
        const prev = latestByFeature.get(key);
        if (!prev || (e.updatedAt || '') > (prev.updatedAt || '')) {
          latestByFeature.set(key, e);
        }
      }

      for (const entry of entries) {
        const run = readRun(projectDir, entry.runId);
        if (!run) continue;
        if (run.status === 'completed') {
          const next = needsNextStep(run);
          if (!next) continue;
          const key = (run.feature || '').toLowerCase();
          const latest = latestByFeature.get(key);
          if (!latest || latest.runId !== run.runId) continue;
        }
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
                // (includes real currentStep, gateState) rather than synthesizing.
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
              currentStep: null,
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
    return {
      runId: r.runId,
      pipelineType: r.pipelineType,
      feature: r.feature || '',
      status: r.status,
      currentStep: r.currentStep || null,
      gateState: r.gateState || null,
    };
  } catch {
    return null;
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

  // Completed with approved gate — requires user to advance
  const next = needsNextStep(run);
  if (next) {
    return `⏸  ${shortId} · run ${next}`;
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

  // Active run — map currentStep to stage
  const config = PIPELINE_STAGES[run.pipelineType];
  if (!config) {
    return `⚙  ${shortId} · ${run.pipelineType || 'running'}`;
  }

  const stepInfo = (run.currentStep && config.steps[run.currentStep])
    || { stage: 1, label: run.currentStep || config.label };

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
