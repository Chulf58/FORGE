#!/usr/bin/env node
// FORGE terminal observer — worktree conductor dashboard (terminal-kit).
//
// Run:  node scripts/forge-observer.mjs   (or use observer.bat)
// Quit: q / Ctrl+C  |  Navigate: ↑↓ / j k / scroll  |  Click: expand  |  Refresh: r
// Tabs: 1=Sessions  2=TODOs  3=Notes  4=Usage

import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');

if (!process.stdout.isTTY) {
  process.stderr.write('[forge-observer] stdout is not a TTY — observer requires a real terminal.\n');
  process.exit(0);
}

const mcpRequire = createRequire(join(PLUGIN_ROOT, 'mcp', 'package.json'));

let termkit, buildDashboardState;
try {
  termkit = mcpRequire('terminal-kit');
  const dsUrl = pathToFileURL(join(PLUGIN_ROOT, 'mcp', 'lib', 'dashboard-state.js')).href;
  const ds = await import(dsUrl);
  buildDashboardState = ds.buildDashboardState;
} catch (err) {
  process.stderr.write('[forge-observer] Failed to load dependencies: ' + err.message + '\n');
  process.stderr.write('[forge-observer] Run `node hooks/mcp-deps-install.js` to install, or start a fresh Claude Code session.\n');
  process.exit(1);
}

const term = termkit.terminal;
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const REFRESH_MS = 2000;

// ── ANSI helpers for buffer-based rendering ─────────────────────────────
const ESC = '\x1b[';
const RESET = ESC + '0m';
const BOLD = ESC + '1m';
const DIM = ESC + '2m';
const COLOR = {
  yellow:  ESC + '33m',
  green:   ESC + '32m',
  red:     ESC + '31m',
  cyan:    ESC + '36m',
  gray:    ESC + '90m',
  white:   ESC + '37m',
  blue:    ESC + '34m',
};
const BG_BLUE = ESC + '44m';
const BG_GRAY = ESC + '100m';

function c(color, text) { return (COLOR[color] || '') + text + RESET; }
function cb(color, text) { return BOLD + (COLOR[color] || '') + text + RESET; }
function cd(color, text) { return DIM + (COLOR[color] || '') + text + RESET; }

// ── Tabs ───────────────────────────────────────────────────────────────
const TABS = [
  { key: '1', label: 'Sessions' },
  { key: '2', label: 'TODOs' },
  { key: '3', label: 'Notes' },
  { key: '4', label: 'Usage' },
];
let currentTab = 0;

// ── Data helpers ────────────────────────────────────────────────────────

function loadAllTodos(projectDir) {
  try {
    const raw = readFileSync(join(projectDir, '.pipeline', 'board.json'), 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.todos) ? data.todos : [];
  } catch (_) { return []; }
}

function loadOpenTodos(projectDir) {
  return loadAllTodos(projectDir).filter(t => t && t.done !== true);
}

function loadNotes(projectDir) {
  try {
    const raw = readFileSync(join(projectDir, '.pipeline', 'notes.json'), 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.notes) ? data.notes : [];
  } catch (_) { return []; }
}

function loadUsage(projectDir) {
  try {
    const raw = readFileSync(join(projectDir, '.pipeline', 'usage.json'), 'utf8');
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function loadFullRun(projectDir, runId) {
  try {
    return JSON.parse(readFileSync(join(projectDir, '.pipeline', 'runs', runId, 'run.json'), 'utf8'));
  } catch (_) { return null; }
}

function gitSync(args, cwd) {
  try {
    return execSync('git ' + args, { cwd, encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (_) { return null; }
}

function extractHandoffSummary(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const sumIdx = lines.findIndex(l => /^##\s*Summary/i.test(l));
  if (sumIdx < 0) {
    const titleLine = lines.find(l => l.startsWith('# '));
    return titleLine ? [titleLine.replace(/^#+\s*/, '')] : [];
  }
  const result = [];
  for (let i = sumIdx + 1; i < lines.length && result.length < 8; i++) {
    if (/^##\s/.test(lines[i])) break;
    const trimmed = lines[i].trim();
    if (trimmed) result.push(trimmed);
  }
  return result;
}

function loadRunSummary(projectDir, run) {
  const summary = { diffStat: null, filesChanged: 0, insertions: 0, deletions: 0, handoffLines: [], commits: [] };
  if (!run) return summary;

  const branch = run.branchName;
  const wtPath = run.worktreePath;

  if (branch) {
    const shortstat = gitSync('diff main..' + branch + ' --shortstat', projectDir);
    if (shortstat) {
      summary.diffStat = shortstat;
      const fm = shortstat.match(/(\d+) file/);
      const im = shortstat.match(/(\d+) insertion/);
      const dm = shortstat.match(/(\d+) deletion/);
      if (fm) summary.filesChanged = parseInt(fm[1], 10);
      if (im) summary.insertions = parseInt(im[1], 10);
      if (dm) summary.deletions = parseInt(dm[1], 10);
    }

    const commitLog = gitSync('log main..' + branch + ' --oneline', projectDir);
    if (commitLog) {
      summary.commits = commitLog.split('\n').filter(Boolean).slice(0, 5);
    }

    const handoff = gitSync('show ' + branch + ':docs/context/handoff.md', projectDir);
    if (handoff) {
      summary.handoffLines = extractHandoffSummary(handoff);
    }
  }

  if (summary.handoffLines.length === 0 && wtPath) {
    const hPath = join(wtPath, 'docs', 'context', 'handoff.md');
    try {
      if (existsSync(hPath)) {
        summary.handoffLines = extractHandoffSummary(readFileSync(hPath, 'utf8'));
      }
    } catch (_) {}
  }

  if (summary.handoffLines.length === 0) {
    const mainHandoff = join(projectDir, 'docs', 'context', 'handoff.md');
    try {
      if (existsSync(mainHandoff)) {
        summary.handoffLines = extractHandoffSummary(readFileSync(mainHandoff, 'utf8'));
      }
    } catch (_) {}
  }

  return summary;
}

function trunc(text, max) {
  if (typeof text !== 'string') return '';
  if (max <= 0) return '';
  return text.length > max ? text.slice(0, max - 1) + '~' : text;
}

function pad(text, w) {
  if (text.length >= w) return text.slice(0, w);
  return text + ' '.repeat(w - text.length);
}

function fmtRel(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return 'now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h';
  return Math.floor(sec / 86400) + 'd';
}

function fmtDuration(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const ms = Date.parse(endIso) - Date.parse(startIso);
  if (Number.isNaN(ms) || ms < 0) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h + 'h ' + m + 'm';
}

function fmtTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

const HEARTBEAT_STALE_MS = 120_000;

function loadHeartbeats(projectDir) {
  const dir = join(projectDir, '.pipeline', 'heartbeats');
  const map = {};
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        if (data.runId) map[data.runId] = data.timestamp || 0;
      } catch (_) {}
    }
  } catch (_) {}
  return map;
}

function loadEscalations(projectDir) {
  const dir = join(projectDir, '.pipeline', 'escalations');
  const map = {};
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        if (data.runId) map[data.runId] = data;
      } catch (_) {}
    }
  } catch (_) {}
  return map;
}

let heartbeats = {};
let escalations = {};

function isLost(run) {
  if (run.status !== 'running') return false;
  const hb = heartbeats[run.runId];
  if (!hb) return false;
  return (Date.now() - hb) > HEARTBEAT_STALE_MS;
}

function statusOf(run) {
  if (escalations[run.runId]) return { dot: '⚠', color: 'red' };
  if (isLost(run)) return { dot: '?', color: 'red' };
  if (run.actionNeeded) return { dot: '⏸', color: 'yellow' };
  if (run.status === 'running') return { dot: '●', color: 'green' };
  if (run.status === 'gate-pending') return { dot: '!', color: 'yellow' };
  if (run.status === 'failed') return { dot: '✕', color: 'red' };
  if (run.status === 'discarded') return { dot: '○', color: 'red' };
  return { dot: '○', color: 'gray' };
}

// ── Pipeline stage mapping ──────────────────────────────────────────────

const PIPELINE_STAGES = {
  plan: {
    totalStages: 5, steps: {
      'started': { stage: 1, label: 'starting' },
      'brainstormer-decision': { stage: 1, label: 'brainstorming' },
      'planner': { stage: 2, label: 'planner' },
      'researcher': { stage: 3, label: 'researcher' },
      'gotcha-checker': { stage: 3, label: 'gotcha-check' },
      'reviewer-triage': { stage: 4, label: 'reviewers' },
      'reviewer-boundary': { stage: 4, label: 'reviewers' },
      'gate1': { stage: 5, label: 'gate1' },
    },
  },
  implement: {
    totalStages: 6, steps: {
      'started': { stage: 1, label: 'starting' },
      'setup': { stage: 1, label: 'setup' },
      'implementation-architect': { stage: 2, label: 'scoping slice' },
      'coder-scout': { stage: 3, label: 'scout' },
      'coder': { stage: 3, label: 'coder' },
      'completeness-checker': { stage: 4, label: 'completeness' },
      'reviewer-triage': { stage: 5, label: 'reviewers' },
      'reviewer-boundary': { stage: 5, label: 'reviewers' },
      'gate2': { stage: 6, label: 'gate2' },
    },
  },
  apply: {
    totalStages: 6, steps: {
      'started': { stage: 1, label: 'starting' },
      'setup': { stage: 1, label: 'setup' },
      'implementer-triage': { stage: 2, label: 'triage' },
      'implementer': { stage: 2, label: 'implementer' },
      'testing': { stage: 3, label: 'tests' },
      'documenter': { stage: 4, label: 'documenter' },
      'worktree-commit': { stage: 5, label: 'wt-commit' },
      'merge-back': { stage: 6, label: 'merge-back' },
      'done': { stage: 6, label: 'done' },
    },
  },
  debug: {
    totalStages: 4, steps: {
      'started': { stage: 1, label: 'starting' },
      'debug': { stage: 2, label: 'tracing' },
      'reviewer-triage': { stage: 3, label: 'reviewers' },
      'reviewer-boundary': { stage: 3, label: 'reviewers' },
      'gate2': { stage: 4, label: 'gate2' },
    },
  },
  refactor: {
    totalStages: 4, steps: {
      'started': { stage: 1, label: 'starting' },
      'refactor': { stage: 2, label: 'analyzing' },
      'reviewer-triage': { stage: 3, label: 'reviewers' },
      'reviewer-boundary': { stage: 3, label: 'reviewers' },
      'gate2': { stage: 4, label: 'gate2' },
    },
  },
};

function renderBar(filled, total) {
  const f = Math.min(Math.max(filled, 0), total);
  return '▓'.repeat(f) + '░'.repeat(Math.max(0, total - f));
}

function runProgress(run) {
  const config = PIPELINE_STAGES[run.pipelineType];
  if (!config) return { bar: '', label: run.pipelineType || 'running' };
  if (run.actionNeeded) {
    return { bar: renderBar(config.totalStages, config.totalStages), label: 'run ' + run.actionNeeded };
  }
  if (run.status === 'gate-pending' && run.gateState) {
    const gate = run.gateState.gate;
    const stepInfo = config.steps[gate] || { stage: config.totalStages };
    return { bar: renderBar(stepInfo.stage, config.totalStages), label: gate === 'gate1' ? 'plan approval needed' : 'approval needed' };
  }
  const stepInfo = (run.currentStep && config.steps[run.currentStep])
    || { stage: 1, label: run.currentStep || 'running' };
  return { bar: renderBar(stepInfo.stage, config.totalStages), label: stepInfo.label };
}

// ── Braille animation frames ────────────────────────────────────────────

const ANIM = {
  running:   ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'],
  attention: ['⡀', '⣀', '⣠', '⣰', '⣸', '⣼', '⣾', '⣿', '⣾', '⣼', '⣸', '⣰', '⣠', '⣀'],
  gate:      ['⠒', '⠲', '⠶', '⠾', '⠞', '⠎', '⠆', '⠂'],
  done:      ['⠀'],
  failed:    ['⣿'],
};

function animIcon(run, frame) {
  if (run.actionNeeded) return ANIM.attention[frame % ANIM.attention.length];
  if (run.status === 'running') return ANIM.running[frame % ANIM.running.length];
  if (run.status === 'gate-pending') return ANIM.gate[frame % ANIM.gate.length];
  if (run.status === 'failed' || run.status === 'discarded') return ANIM.failed[0];
  return ANIM.done[0];
}

// ── Display order ───────────────────────────────────────────────────────

function mergeOrder(freshWorkers, orderedIds) {
  const idSet = new Set(freshWorkers.map(w => w.runId));
  const kept = orderedIds.filter(id => idSet.has(id));
  const keptSet = new Set(kept);
  const added = freshWorkers.filter(w => !keptSet.has(w.runId)).map(w => w.runId);
  const finalIds = [...kept, ...added];
  const byId = Object.fromEntries(freshWorkers.map(w => [w.runId, w]));
  return finalIds.map(id => byId[id]).filter(Boolean);
}

// ── Banner (truecolor braille anvil + gradient FORGE text) ──────────────

function rgb(r, g, b) { return `\x1b[38;2;${r};${g};${b}m`; }
function lerp(c1, c2, t) {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t),
  ];
}

const FONT = {
  F: ['████', '█   ', '███ ', '█   ', '█   '],
  O: [' ██ ', '█  █', '█  █', '█  █', ' ██ '],
  R: ['███ ', '█  █', '███ ', '█ █ ', '█  █'],
  G: [' ███', '█   ', '█ ██', '█  █', ' ███'],
  E: ['████', '█   ', '███ ', '█   ', '████'],
};

function buildBanner() {
  const X_ = RESET;
  const colors = [[255, 205, 50], [255, 140, 30], [215, 45, 25]];
  const word = 'FORGE', gap = '  ';
  const totalW = word.length * 4 + (word.length - 1) * gap.length;
  const txt = [];
  for (let row = 0; row < 5; row++) {
    let line = '', col = 0;
    for (let i = 0; i < word.length; i++) {
      const chars = FONT[word[i]][row];
      for (let ci = 0; ci < 4; ci++) {
        const ch = chars[ci] || ' ';
        if (ch !== ' ') {
          const t = totalW > 1 ? col / (totalW - 1) : 0;
          const seg = Math.min(Math.floor(t * (colors.length - 1)), colors.length - 2);
          const rc = lerp(colors[seg], colors[seg + 1], t * (colors.length - 1) - seg);
          line += rgb(rc[0], rc[1], rc[2]) + ch + X_;
        } else {
          line += ' ';
        }
        col++;
      }
      if (i < word.length - 1) { line += gap; col += gap.length; }
    }
    txt.push(line);
  }

  return [
    '  ' + txt[0],
    '  ' + txt[1],
    '  ' + txt[2],
    '  ' + txt[3],
    '  ' + txt[4],
  ];
}

const BANNER = buildBanner();

// ── State ───────────────────────────────────────────────────────────────

let state = null;
let todos = [];
let notes = [];
let usage = null;
let workers = [];
let completed = [];
let orderedIds = [];
let selectedIdx = 0;
let expandedIdx = -1;
let todoSelectedIdx = 0;
let todoExpandedIdx = -1;
let animFrame = 0;
let notifiedDone = new Set();

// ── Refresh ─────────────────────────────────────────────────────────────

function isUnacknowledgedResearch(run) {
  return run.pipelineType === 'research' && run.status === 'completed' && !run.acknowledged;
}

function loadWorkerDone(projectDir) {
  const dir = join(projectDir, '.pipeline', 'worker-done');
  const results = [];
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        results.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      } catch (_) {}
    }
  } catch (_) {}
  return results;
}

function refresh() {
  try {
    state = buildDashboardState(PROJECT_DIR);
    todos = loadOpenTodos(PROJECT_DIR);
    notes = loadNotes(PROJECT_DIR);
    usage = loadUsage(PROJECT_DIR);
    heartbeats = loadHeartbeats(PROJECT_DIR);
    escalations = loadEscalations(PROJECT_DIR);

    const gates = (state.activeRuns || []).filter(r => r.status === 'gate-pending');
    const active = (state.activeRuns || []).filter(r => r.status !== 'gate-pending');

    const unackResearch = (state.recentCompleted || [])
      .map(r => loadFullRun(PROJECT_DIR, r.runId) || r)
      .filter(isUnacknowledgedResearch);

    const freshWorkers = [...gates, ...active, ...unackResearch];
    workers = mergeOrder(freshWorkers, orderedIds);
    orderedIds = workers.map(w => w.runId);

    const unackIds = new Set(unackResearch.map(r => r.runId));
    completed = (state.recentCompleted || []).filter(r => !unackIds.has(r.runId));

    if (currentTab === 0) {
      const total = workers.length + completed.length;
      if (expandedIdx >= total) expandedIdx = -1;
      if (selectedIdx >= total) selectedIdx = Math.max(0, total - 1);
    }

    for (const r of unackResearch) {
      if (!notifiedDone.has(r.runId)) {
        notifiedDone.add(r.runId);
        flash('Research done: ' + (r.feature || r.runId));
        process.stdout.write('\x07');
      }
    }
  } catch (err) {
    state = null;
  }
}

// ── Frame buffer rendering ──────────────────────────────────────────────

const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };
const BOX_SEL = { tl: '█', tr: '█', bl: '█', br: '█', h: '█', v: '█' };

let cardRegions = [];
let scrollOffset = 0;

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function buildTabBar(cols) {
  let line = '  ';
  for (let i = 0; i < TABS.length; i++) {
    const tab = TABS[i];
    const label = ' ' + tab.key + ' ' + tab.label + ' ';
    if (i === currentTab) {
      line += BOLD + BG_BLUE + COLOR.white + label + RESET;
    } else {
      line += DIM + COLOR.gray + label + RESET;
    }
    if (i < TABS.length - 1) line += ' ';
  }
  return line;
}

function buildHeader(cols) {
  const lines = [];
  if (!state) {
    for (const line of BANNER) lines.push(line);
    lines.push(c('gray', '  loading...'));
    return lines;
  }

  const activeCount = (state.activeRuns || []).filter(r => r.status === 'running').length;
  const gateCount = (state.gatesAwaiting || []).length;
  const attentionCount = (state.activeRuns || []).filter(r => r.actionNeeded).length;

  for (const line of BANNER) lines.push(line);
  let statusParts = [];
  if (activeCount > 0) statusParts.push(c('green', '● ' + activeCount));
  if (gateCount > 0) statusParts.push(c('yellow', '! ' + gateCount));
  if (attentionCount > 0) statusParts.push(c('yellow', '⏸ ' + attentionCount));
  if (todos.length > 0) statusParts.push(c('cyan', '☐ ' + todos.length));
  if (statusParts.length === 0) statusParts.push(c('gray', 'idle'));
  lines.push('  ' + statusParts.join('  '));
  lines.push('');
  lines.push(buildTabBar(cols));
  lines.push(c('gray', '─'.repeat(cols)));
  return lines;
}

// ── Tab 1: Sessions ─────────────────────────────────────────────────────

function buildSessionsTab(cols) {
  const inner = Math.max(20, cols - 4);
  const lines = [];
  const regions = [];

  function push(text) { lines.push(text); }
  function blank() { lines.push(''); }
  function sep(label) {
    const dashLen = Math.max(0, cols - label.length - 4);
    push(c('gray', '── ') + cb('cyan', label) + c('gray', ' ' + '─'.repeat(dashLen)));
  }
  function boxTop(w, clr, b, bold) {
    const s = bold ? cb : c;
    return s(clr, b.tl + b.h.repeat(w - 2) + b.tr);
  }
  function boxMid(w, clr, b, content, bold) {
    const vis = stripAnsi(content);
    const s = bold ? cb : c;
    return s(clr, b.v) + content + ' '.repeat(Math.max(0, w - 2 - vis.length)) + s(clr, b.v);
  }
  function boxBot(w, clr, b, bold) {
    const s = bold ? cb : c;
    return s(clr, b.bl + b.h.repeat(w - 2) + b.br);
  }

  if (!state) return { lines, regions };

  if (workers.length > 0) {
    for (let i = 0; i < workers.length; i++) {
      const run = workers[i];
      const isSelected = selectedIdx === i;
      const isExpanded = expandedIdx === i;
      const s = statusOf(run);
      const p = runProgress(run);
      const icon = animIcon(run, animFrame);
      const borderColor = isSelected ? 'green' : s.color;
      const box = isSelected ? BOX_SEL : BOX;
      const shortId = (run.runId || '').slice(0, 10);
      const feature = trunc(run.feature || '(unnamed)', inner - 2);
      const time = fmtRel(run.updatedAt);

      let detailRows = [];
      if (isExpanded) {
        const fullRun = loadFullRun(PROJECT_DIR, run.runId) || run;
        const merged = { ...run, ...fullRun, actionNeeded: run.actionNeeded || null };
        detailRows.push(['Pipeline', (merged.pipelineType || '') + (merged.mode ? ' (' + merged.mode + ')' : '')]);
        detailRows.push(['Status', (merged.status || '') + (merged.stageLabel ? ' — ' + merged.stageLabel : '')]);
        if (merged.branchName) detailRows.push(['Branch', merged.branchName]);
        if (merged.worktreePath) detailRows.push(['Worktree', merged.worktreePath.replace(/.*[/\\]/, '')]);
        detailRows.push(['Created', fmtTimestamp(merged.createdAt)]);
        detailRows.push(['Updated', fmtTimestamp(merged.updatedAt)]);
        const dur = fmtDuration(merged.createdAt, merged.updatedAt);
        if (dur) detailRows.push(['Duration', dur]);
        if (merged.gateState) detailRows.push(['Gate', merged.gateState.gate + ' — ' + merged.gateState.status]);
        if (merged.mergeBlocked) detailRows.push(['Blocked', merged.mergeBlocked.reason || 'merge blocked']);
        if (merged.currentUnit) detailRows.push(['Agent', merged.currentUnit.agent || '']);
        if (merged.actionNeeded) detailRows.push(['Action', '⏸ ' + merged.actionNeeded]);
        if (isLost(merged)) detailRows.push(['Worker', '? LOST — heartbeat stale, press R to resume']);
        const esc = escalations[run.runId];
        if (esc) detailRows.push(['Escalation', '⚠ ' + (esc.message || esc.type || 'needs attention')]);
      }

      const cardH = 5 + detailRows.length;
      const startLine = lines.length;
      regions.push({ idx: i, bodyLine: startLine, h: cardH, type: 'worker' });

      push(boxTop(cols, borderColor, box, isSelected));
      push(boxMid(cols, borderColor, box, ' ' + c(s.color, icon) + ' ' + c('gray', shortId), isSelected));
      push(boxMid(cols, borderColor, box, ' ' + (isSelected ? cb('white', feature) : feature), isSelected));
      const barLabel = trunc(p.label, Math.max(4, inner - p.bar.length - time.length - 4));
      push(boxMid(cols, borderColor, box, ' ' + c(s.color, p.bar) + ' ' + c('gray', barLabel) + '  ' + cd('gray', time), isSelected));
      for (const [label, value] of detailRows) {
        const valColor = label === 'Status' ? s.color : (label === 'Action' ? 'yellow' : 'white');
        push(boxMid(cols, borderColor, box, ' ' + c('gray', label.padEnd(10)) + ' ' + c(valColor, trunc(String(value), Math.max(8, inner - 14))), isSelected));
      }
      push(boxBot(cols, borderColor, box, isSelected));
    }
  }

  if (workers.length === 0 && completed.length === 0) {
    blank();
    push(c('gray', '  No active sessions'));
    push(c('gray', '  Start work in Claude Code — sessions appear here automatically'));
  }

  if (completed.length > 0) {
    blank();
    sep('Completed');
    for (let i = 0; i < completed.length; i++) {
      const gi = workers.length + i;
      const run = completed[i];
      const isSelected = selectedIdx === gi;
      const s = statusOf(run);
      const time = fmtRel(run.updatedAt);
      const type = (run.pipelineType || '').padEnd(10);
      const dur = fmtDuration(run.createdAt, run.updatedAt);
      const feature = trunc(run.feature || '', Math.max(6, cols - 26 - time.length - dur.length));
      regions.push({ idx: gi, bodyLine: lines.length, h: 1, type: 'completed' });
      if (isSelected) {
        push(BG_BLUE + ESC + '37m' + ' ❯' + RESET + c(s.color, s.dot + ' ') + type + ' ' + cd('gray', feature) + '  ' + cd('gray', dur) + '  ' + cd('gray', time));
      } else {
        push('  ' + c(s.color, s.dot + ' ') + cd('gray', type + ' ') + cd('gray', feature) + '  ' + cd('gray', dur) + '  ' + cd('gray', time));
      }
    }
  }

  return { lines, regions };
}

// ── Tab 2: TODOs ────────────────────────────────────────────────────────

function todoPriorityColor(pri) {
  if (pri === 'high') return 'red';
  if (pri === 'medium') return 'yellow';
  return 'gray';
}

function todoPriorityIcon(pri) {
  if (pri === 'high') return '!!';
  if (pri === 'medium') return ' !';
  return '  ';
}

function todoTitle(t) {
  if (t.title) return t.title;
  const text = typeof t.text === 'string' ? t.text : '';
  const stripped = text.split('\n')[0].replace(/^(\[?[A-Z]+\]?):\s*/i, '').trim();
  const dot = stripped.indexOf('. ');
  if (dot > 0 && dot <= 60) return stripped.slice(0, dot);
  if (stripped.length <= 60) return stripped;
  const cut = stripped.lastIndexOf(' ', 60);
  return cut > 20 ? stripped.slice(0, cut) : stripped.slice(0, 60);
}

function todoSummary(t) {
  if (t.summary) return t.summary;
  const text = typeof t.text === 'string' ? t.text : '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length <= 1) return '';
  const body = lines.join(' ').replace(/^(\[?[A-Z]+\]?):\s*/i, '');
  const sentences = body.match(/[^.!?]+[.!?]+/g) || [body];
  let sum = '';
  for (const s of sentences) {
    const trimmed = s.trim();
    const candidate = sum ? sum + ' ' + trimmed : trimmed;
    if (sum && candidate.length > 160) break;
    sum = candidate;
    if (sum.length >= 80) break;
  }
  return sum || body.slice(0, 160);
}

function buildTodosTab(cols) {
  const inner = Math.max(20, cols - 4);
  const lines = [];
  const regions = [];
  const allTodos = loadAllTodos(PROJECT_DIR);
  const open = allTodos.filter(t => t && t.done !== true);
  const done = allTodos.filter(t => t && t.done === true);

  function push(text) { lines.push(text); }
  function blank() { lines.push(''); }
  function boxTop(w, clr, b, bold) {
    const s = bold ? cb : c;
    return s(clr, b.tl + b.h.repeat(w - 2) + b.tr);
  }
  function boxMid(w, clr, b, content, bold) {
    const vis = stripAnsi(content);
    const s = bold ? cb : c;
    return s(clr, b.v) + content + ' '.repeat(Math.max(0, w - 2 - vis.length)) + s(clr, b.v);
  }
  function boxBot(w, clr, b, bold) {
    const s = bold ? cb : c;
    return s(clr, b.bl + b.h.repeat(w - 2) + b.br);
  }

  if (open.length === 0 && done.length === 0) {
    blank();
    push(c('gray', '  No TODOs yet'));
    push(c('gray', '  Use /forge:todo or forge_add_todo to add items'));
    return { lines, regions };
  }

  const totalTodos = open.length;
  if (todoSelectedIdx >= totalTodos) todoSelectedIdx = Math.max(0, totalTodos - 1);
  if (todoExpandedIdx >= totalTodos) todoExpandedIdx = -1;

  for (let i = 0; i < open.length; i++) {
    const t = open[i];
    const isSelected = todoSelectedIdx === i;
    const isExpanded = todoExpandedIdx === i;
    const priColor = todoPriorityColor(t.priority);
    const priIcon = todoPriorityIcon(t.priority);
    const title = todoTitle(t);
    const summary = todoSummary(t);
    const age = fmtRel(t.createdAt || t.addedAt);
    const tags = Array.isArray(t.tags) && t.tags.length > 0 ? t.tags.map(tag => '#' + tag).join(' ') : '';
    const borderColor = isSelected ? 'cyan' : priColor;
    const box = isSelected ? BOX_SEL : BOX;

    let detailRows = [];
    if (isExpanded) {
      if (summary) {
        const sumWords = summary.split(' ');
        let line = '';
        for (const w of sumWords) {
          const candidate = line ? line + ' ' + w : w;
          if (candidate.length > inner - 6) {
            detailRows.push(['_sum', line]);
            line = w;
          } else {
            line = candidate;
          }
        }
        if (line) detailRows.push(['_sum', line]);
      }
      const rawText = typeof t.text === 'string' ? t.text : '';
      const prefix = rawText.match(/^(\[?[A-Z]+\]?):/)?.[0] || '';
      if (prefix) detailRows.push(['Type', prefix.replace(':', '')]);
      if (t.priority) detailRows.push(['Priority', t.priority]);
      if (tags) detailRows.push(['Tags', tags]);
      if (t.createdAt || t.addedAt) detailRows.push(['Added', fmtTimestamp(t.createdAt || new Date(t.addedAt).toISOString())]);
    }

    const cardH = 5 + detailRows.length;
    regions.push({ idx: i, bodyLine: lines.length, h: cardH, type: 'todo' });

    push(boxTop(cols, borderColor, box, isSelected));
    push(boxMid(cols, borderColor, box, ' ' + (isSelected ? cb('white', trunc(title, inner - 4)) : trunc(title, inner - 4)), isSelected));
    const sumPreview = summary ? trunc(summary, Math.max(6, inner - 2)) : '';
    push(boxMid(cols, borderColor, box, ' ' + cd('gray', sumPreview), isSelected));
    const priPart = c(priColor, priIcon);
    const tagsTail = tags ? ' ' + c('cyan', trunc(tags, Math.max(6, inner - 8))) : '';
    const agePart = age ? '  ' + cd('gray', age) : '';
    push(boxMid(cols, borderColor, box, ' ' + priPart + tagsTail + agePart, isSelected));
    for (const [label, value] of detailRows) {
      if (label === '_sum') {
        push(boxMid(cols, borderColor, box, '   ' + c('white', trunc(String(value), inner - 6)), isSelected));
      } else {
        const valColor = label === 'Priority' ? priColor : (label === 'Tags' ? 'cyan' : 'white');
        push(boxMid(cols, borderColor, box, ' ' + c('gray', label.padEnd(10)) + ' ' + c(valColor, trunc(String(value), Math.max(8, inner - 14))), isSelected));
      }
    }
    push(boxBot(cols, borderColor, box, isSelected));
  }

  if (done.length > 0) {
    blank();
    push(cd('gray', '  ── Done (' + done.length + ') ──'));
    const limit = 5;
    for (let i = 0; i < Math.min(done.length, limit); i++) {
      const t = done[i];
      push(cd('gray', '  ☑ ' + trunc(todoTitle(t), cols - 8)));
    }
    if (done.length > limit) {
      push(cd('gray', '    +' + (done.length - limit) + ' more'));
    }
  }

  return { lines, regions };
}

// ── Tab 3: Notes ────────────────────────────────────────────────────────

function buildNotesTab(cols) {
  const lines = [];

  if (notes.length === 0) {
    lines.push('');
    lines.push(c('gray', '  No notes yet'));
    lines.push(c('gray', '  Use /forge:note or forge_add_note to capture knowledge'));
    return { lines, regions: [] };
  }

  lines.push('');
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const text = typeof n.text === 'string' ? n.text : '';
    const tags = Array.isArray(n.tags) && n.tags.length > 0
      ? c('cyan', n.tags.map(tag => '#' + tag).join(' ')) + ' '
      : '';
    const age = n.createdAt ? cd('gray', fmtRel(n.createdAt)) : '';
    const firstLine = text.split('\n')[0];

    lines.push('  ' + c('yellow', '▸') + ' ' + cb('white', trunc(firstLine, Math.max(10, cols - 20))) + '  ' + age);
    if (tags) lines.push('    ' + tags);

    const rest = text.split('\n').slice(1).filter(l => l.trim());
    for (let j = 0; j < Math.min(rest.length, 2); j++) {
      lines.push('    ' + cd('gray', trunc(rest[j].trim(), cols - 8)));
    }
    if (rest.length > 2) {
      lines.push(cd('gray', '    ...' + (rest.length - 2) + ' more lines'));
    }

    if (i < notes.length - 1) lines.push('');
  }

  return { lines, regions: [] };
}

// ── Tab 4: Usage ────────────────────────────────────────────────────────

function buildUsageTab(cols) {
  const lines = [];
  lines.push('');

  if (!usage) {
    lines.push(c('gray', '  No usage data available'));
    lines.push(c('gray', '  Usage tracking activates during pipeline runs'));
    return { lines, regions: [] };
  }

  if (usage.sessions) {
    const s = usage.sessions;
    lines.push('  ' + cb('cyan', 'Session'));
    if (s.totalRuns !== undefined) lines.push('    ' + c('gray', 'Runs:   ') + c('white', String(s.totalRuns)));
    if (s.totalAgents !== undefined) lines.push('    ' + c('gray', 'Agents: ') + c('white', String(s.totalAgents)));
    lines.push('');
  }

  if (usage.tokens) {
    const t = usage.tokens;
    lines.push('  ' + cb('cyan', 'Tokens'));
    if (t.input !== undefined) lines.push('    ' + c('gray', 'Input:  ') + c('white', Number(t.input).toLocaleString()));
    if (t.output !== undefined) lines.push('    ' + c('gray', 'Output: ') + c('white', Number(t.output).toLocaleString()));
    if (t.total !== undefined) lines.push('    ' + c('gray', 'Total:  ') + cb('white', Number(t.total).toLocaleString()));
    lines.push('');
  }

  if (usage.cost) {
    lines.push('  ' + cb('cyan', 'Cost'));
    if (usage.cost.estimated !== undefined) {
      lines.push('    ' + c('gray', 'Est:    ') + cb('yellow', '$' + Number(usage.cost.estimated).toFixed(2)));
    }
  }

  if (Object.keys(usage).length === 0 || (!usage.sessions && !usage.tokens && !usage.cost)) {
    lines.push(c('gray', '  Usage data format not recognized'));
    lines.push(c('gray', '  Raw keys: ' + Object.keys(usage).join(', ')));
  }

  return { lines, regions: [] };
}

// ── Build body (dispatches to active tab) ───────────────────────────────

function buildBody(cols) {
  switch (currentTab) {
    case 0: return buildSessionsTab(cols);
    case 1: return buildTodosTab(cols);
    case 2: return buildNotesTab(cols);
    case 3: return buildUsageTab(cols);
    default: return { lines: [], regions: [] };
  }
}

function activeSelectedIdx() {
  if (currentTab === 1) return todoSelectedIdx;
  return selectedIdx;
}

function autoScroll(bodyLines, regions, viewportH) {
  if (currentTab !== 0 && currentTab !== 1) {
    scrollOffset = 0;
    return;
  }
  const sel = activeSelectedIdx();
  let targetStart = -1, targetEnd = -1;
  for (const r of regions) {
    if (r.idx === sel) {
      targetStart = r.bodyLine;
      targetEnd = r.bodyLine + r.h;
      break;
    }
  }
  if (targetStart < 0) return;
  if (targetStart < scrollOffset) {
    scrollOffset = targetStart;
  } else if (targetEnd > scrollOffset + viewportH) {
    scrollOffset = targetEnd - viewportH;
  }
  scrollOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, bodyLines - viewportH)));
}

function draw() {
  const cols = term.width;
  const rows = term.height;

  const header = buildHeader(cols);
  const { lines: body, regions } = buildBody(cols);

  const headerH = header.length;
  const footerH = 1;
  const viewportH = rows - headerH - footerH;

  autoScroll(body.length, regions, viewportH);

  cardRegions = [];
  for (const r of regions) {
    const screenLine = r.bodyLine - scrollOffset;
    if (screenLine + r.h <= 0 || screenLine >= viewportH) continue;
    cardRegions.push({
      idx: r.idx,
      y: headerH + screenLine + 1,
      h: r.h,
      type: r.type,
    });
  }

  const out = [];
  out.push(ESC + 'H');
  out.push(ESC + '?25l');

  for (let i = 0; i < headerH; i++) {
    const vis = stripAnsi(header[i]);
    out.push(header[i] + ' '.repeat(Math.max(0, cols - vis.length)));
    out.push('\r\n');
  }

  for (let i = 0; i < viewportH; i++) {
    const bodyIdx = scrollOffset + i;
    if (bodyIdx < body.length) {
      const vis = stripAnsi(body[bodyIdx]);
      out.push(body[bodyIdx] + ' '.repeat(Math.max(0, cols - vis.length)));
    } else {
      out.push(' '.repeat(cols));
    }
    out.push('\r\n');
  }

  let footerText;
  if (flashMessage) {
    footerText = BOLD + COLOR.green + ' ✓ ' + flashMessage + RESET;
  } else {
    const tabHints = '[←→] tabs';
    let modeHints;
    if (currentTab === 0) {
      modeHints = expandedIdx >= 0
        ? '[↑↓] select  [⏎] toggle  [R] resume  [ESC] close'
        : '[↑↓] select  [⏎] open  [R] resume';
    } else if (currentTab === 1) {
      modeHints = todoExpandedIdx >= 0
        ? '[↑↓] select  [⏎] toggle  [ESC] close'
        : '[↑↓] select  [⏎] open';
    } else {
      modeHints = '';
    }
    const globalHints = '[r] refresh  [q] quit';
    const allHints = [tabHints, modeHints, globalHints].filter(Boolean).join('  ');
    footerText = DIM + COLOR.gray + trunc(allHints, cols) + RESET;
  }
  const footerVis = stripAnsi(footerText);
  out.push(footerText + ' '.repeat(Math.max(0, cols - footerVis.length)));

  process.stdout.write(out.join(''));
}

// ── Input handling ──────────────────────────────────────────────────────

function totalItems() {
  if (currentTab === 1) return todos.length;
  return workers.length + completed.length;
}

function signalSelection() {
  if (currentTab === 0) {
    const run = getSelectedRun();
    if (run) writeObserverSignal(run);
  } else if (currentTab === 1) {
    const todo = getSelectedTodo();
    if (todo) writeObserverSignalTodo(todo);
  }
}

function selectPrev() {
  if (currentTab === 0) {
    if (selectedIdx > 0) { selectedIdx--; signalSelection(); draw(); }
  } else if (currentTab === 1) {
    if (todoSelectedIdx > 0) { todoSelectedIdx--; signalSelection(); draw(); }
  }
}

function selectNext() {
  if (currentTab === 0) {
    if (selectedIdx < workers.length + completed.length - 1) { selectedIdx++; signalSelection(); draw(); }
  } else if (currentTab === 1) {
    if (todoSelectedIdx < todos.length - 1) { todoSelectedIdx++; signalSelection(); draw(); }
  }
}

function toggleExpand(idx) {
  if (currentTab === 0) {
    if (idx === undefined) idx = selectedIdx;
    if (idx < 0 || idx >= workers.length + completed.length) return;
    if (expandedIdx === idx) {
      expandedIdx = -1;
    } else {
      expandedIdx = idx;
      selectedIdx = idx;
    }
    signalSelection();
    draw();
  } else if (currentTab === 1) {
    if (idx === undefined) idx = todoSelectedIdx;
    if (idx < 0 || idx >= todos.length) return;
    if (todoExpandedIdx === idx) {
      todoExpandedIdx = -1;
    } else {
      todoExpandedIdx = idx;
      todoSelectedIdx = idx;
    }
    signalSelection();
    draw();
  }
}

function collapseExpand() {
  if (currentTab === 0 && expandedIdx >= 0) { expandedIdx = -1; draw(); }
  if (currentTab === 1 && todoExpandedIdx >= 0) { todoExpandedIdx = -1; draw(); }
}

function getSelectedTodo() {
  if (todoSelectedIdx >= 0 && todoSelectedIdx < todos.length) return todos[todoSelectedIdx];
  return null;
}

function writeObserverSignalTodo(todo) {
  if (!todo) return;
  const signal = {
    type: 'todo',
    text: todo.text || '',
    priority: todo.priority || null,
    tags: todo.tags || [],
    todoId: todo.id || null,
    createdAt: todo.createdAt || null,
    selectedAt: new Date().toISOString(),
  };
  const dir = join(PROJECT_DIR, '.pipeline');
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'observer-selected.json'), JSON.stringify(signal, null, 2) + '\n', 'utf8');
  } catch (_) {}
}

function switchTab(idx) {
  if (idx === currentTab) return;
  currentTab = idx;
  scrollOffset = 0;
  draw();
}

function getSelectedRun() {
  if (selectedIdx < workers.length) return workers[selectedIdx];
  const ci = selectedIdx - workers.length;
  if (ci >= 0 && ci < completed.length) {
    return loadFullRun(PROJECT_DIR, completed[ci].runId) || completed[ci];
  }
  return null;
}

function writeObserverSignal(run) {
  if (!run || !run.runId) return;
  const ws = loadRunSummary(PROJECT_DIR, run);
  const signal = {
    runId: run.runId,
    feature: run.feature || '',
    pipelineType: run.pipelineType || '',
    mode: run.mode || null,
    status: run.status || '',
    branchName: run.branchName || null,
    worktreePath: run.worktreePath || null,
    gateState: run.gateState || null,
    actionNeeded: run.actionNeeded || null,
    mergeBlocked: run.mergeBlocked || null,
    summary: {
      diffStat: ws.diffStat,
      filesChanged: ws.filesChanged,
      insertions: ws.insertions,
      deletions: ws.deletions,
      commits: ws.commits,
      handoffLines: ws.handoffLines,
    },
    selectedAt: new Date().toISOString(),
  };
  const dir = join(PROJECT_DIR, '.pipeline');
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'observer-selected.json'), JSON.stringify(signal, null, 2) + '\n', 'utf8');
  } catch (_) {}
}

let flashMessage = '';
let flashTimer = null;

function flash(msg) {
  flashMessage = msg;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashMessage = ''; draw(); }, 2000);
  draw();
}

function resumeWorker() {
  if (currentTab !== 0) return;
  const run = getSelectedRun();
  if (!run || !run.runId) return;
  const workerName = 'worker-' + run.runId;
  const wtPath = run.worktreePath || PROJECT_DIR;
  try {
    execSync('where wt.exe', { stdio: 'ignore', timeout: 2000 });
  } catch (_) {
    flash('wt.exe not found');
    return;
  }
  try {
    const child = spawn('wt.exe', [
      '-w', '0', 'nt',
      '-d', wtPath,
      '--title', (run.feature || run.runId).slice(0, 60),
      '--', 'claude', '--resume', workerName,
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    flash('Resumed ' + run.runId + ' in new tab');
  } catch (err) {
    flash('Resume failed: ' + err.message);
  }
}

function quit() {
  term.grabInput(false);
  process.stdout.write(ESC + '?1049l');
  process.stdout.write(ESC + '?25h');
  process.exit(0);
}

function hitTest(termY) {
  for (const region of cardRegions) {
    if (termY >= region.y && termY < region.y + region.h) {
      return region.idx;
    }
  }
  return -1;
}

function drawAnimOnly() {
  if (currentTab !== 0) return;
  animFrame++;
  const parts = [];
  for (const region of cardRegions) {
    if (region.type !== 'worker') continue;
    const run = workers[region.idx];
    if (!run) continue;
    const s = statusOf(run);
    const icon = animIcon(run, animFrame);
    parts.push(ESC + (region.y + 1) + ';3H' + (COLOR[s.color] || '') + icon + RESET);
  }
  if (parts.length > 0) {
    process.stdout.write(parts.join(''));
  }
}

// ── Main ────────────────────────────────────────────────────────────────

process.stdout.write(ESC + '?1049h');
process.stdout.write(ESC + '?25l');
term.grabInput({ mouse: 'button', focus: true });

term.on('key', (name) => {
  switch (name) {
    case 'q': case 'Q': case 'CTRL_C': quit(); break;
    case '1': switchTab(0); break;
    case '2': switchTab(1); break;
    case '3': switchTab(2); break;
    case '4': switchTab(3); break;
    case 'LEFT': case 'h': switchTab(Math.max(0, currentTab - 1)); break;
    case 'RIGHT': case 'l': switchTab(Math.min(TABS.length - 1, currentTab + 1)); break;
    case 'UP': case 'k': selectPrev(); break;
    case 'DOWN': case 'j': selectNext(); break;
    case 'ENTER': toggleExpand(); break;
    case 'ESCAPE': collapseExpand(); break;
    case 'r': refresh(); draw(); break;
    case 'R': resumeWorker(); break;
  }
});

term.on('mouse', (name, data) => {
  switch (name) {
    case 'MOUSE_LEFT_BUTTON_PRESSED': {
      if (currentTab === 0 || currentTab === 1) {
        const idx = hitTest(data.y);
        if (idx >= 0) toggleExpand(idx);
      }
      break;
    }
    case 'MOUSE_RIGHT_BUTTON_PRESSED': {
      collapseExpand();
      break;
    }
    case 'MOUSE_WHEEL_UP': {
      selectPrev();
      break;
    }
    case 'MOUSE_WHEEL_DOWN': {
      selectNext();
      break;
    }
  }
});

refresh();
draw();

setInterval(() => { refresh(); draw(); }, REFRESH_MS);
setInterval(drawAnimOnly, 150);
term.on('resize', () => { draw(); });
