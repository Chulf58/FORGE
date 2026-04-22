#!/usr/bin/env node
// FORGE terminal observer — worktree conductor dashboard (terminal-kit).
//
// Run:  node scripts/forge-observer.mjs   (or use observer.bat)
// Quit: q / Ctrl+C  |  Navigate: ↑↓ / j k / scroll  |  Click: expand  |  Refresh: r

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
// We compose the entire frame as a string, then write once — zero flicker.

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

function c(color, text) { return (COLOR[color] || '') + text + RESET; }
function cb(color, text) { return BOLD + (COLOR[color] || '') + text + RESET; }
function cd(color, text) { return DIM + (COLOR[color] || '') + text + RESET; }

// ── Data helpers ────────────────────────────────────────────────────────

function loadOpenTodos(projectDir) {
  try {
    const raw = readFileSync(join(projectDir, '.pipeline', 'board.json'), 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.todos) ? data.todos.filter(t => t && t.done !== true) : [];
  } catch (_) { return []; }
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
let workers = [];
let completed = [];
let orderedIds = [];
let selectedIdx = 0;
let expandedIdx = -1;
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
    heartbeats = loadHeartbeats(PROJECT_DIR);
    escalations = loadEscalations(PROJECT_DIR);

    const gates = (state.activeRuns || []).filter(r => r.status === 'gate-pending');
    const active = (state.activeRuns || []).filter(r => r.status !== 'gate-pending');

    // Unacknowledged research runs stay in active list even when completed
    const unackResearch = (state.recentCompleted || [])
      .map(r => loadFullRun(PROJECT_DIR, r.runId) || r)
      .filter(isUnacknowledgedResearch);

    const freshWorkers = [...gates, ...active, ...unackResearch];
    workers = mergeOrder(freshWorkers, orderedIds);
    orderedIds = workers.map(w => w.runId);

    // Completed list excludes unacknowledged research (they're in workers)
    const unackIds = new Set(unackResearch.map(r => r.runId));
    completed = (state.recentCompleted || []).filter(r => !unackIds.has(r.runId));

    const total = workers.length + completed.length;
    if (expandedIdx >= total) expandedIdx = -1;
    if (selectedIdx >= total) selectedIdx = Math.max(0, total - 1);

    // Flash + bell for newly completed research
    for (const r of unackResearch) {
      if (!notifiedDone.has(r.runId)) {
        notifiedDone.add(r.runId);
        flash('Research done: ' + (r.feature || r.runId));
        process.stdout.write('\x07'); // terminal bell
      }
    }
  } catch (err) {
    state = null;
  }
}

// ── Frame buffer rendering ──────────────────────────────────────────────
// Build entire frame as array of padded lines, then flush to terminal
// in a single process.stdout.write(). Zero flicker.

const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };
const BOX_SEL = { tl: '█', tr: '█', bl: '█', br: '█', h: '█', v: '█' };

let cardRegions = [];
let scrollOffset = 0;

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
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
  const doneCount = (state.recentCompleted || []).length;

  for (const line of BANNER) lines.push(line);
  let statusParts = [];
  if (activeCount > 0) statusParts.push(c('green', '● ' + activeCount));
  if (gateCount > 0) statusParts.push(c('yellow', '! ' + gateCount));
  if (attentionCount > 0) statusParts.push(c('yellow', '⏸ ' + attentionCount));
  if (doneCount > 0) statusParts.push(c('gray', '○ ' + doneCount));
  if (statusParts.length === 0) statusParts.push(c('gray', 'idle'));
  lines.push('  ' + statusParts.join('  '));
  return lines;
}

function buildBody(cols) {
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

  // ── Workers ──
  if (workers.length > 0) {
    sep('Workers');
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
    push(c('gray', '  (no active workers)'));
  }

  // ── Recent ──
  if (completed.length > 0) {
    blank();
    sep('Recent');
    for (let i = 0; i < completed.length; i++) {
      const gi = workers.length + i;
      const run = completed[i];
      const isSelected = selectedIdx === gi;
      const s = statusOf(run);
      const time = fmtRel(run.updatedAt);
      const type = (run.pipelineType || '').padEnd(10);
      const feature = trunc(run.feature || '', Math.max(6, cols - 20 - time.length));
      regions.push({ idx: gi, bodyLine: lines.length, h: 1, type: 'completed' });
      if (isSelected) {
        push(BG_BLUE + ESC + '37m' + ' ❯' + RESET + c(s.color, s.dot + ' ') + type + ' ' + cd('gray', feature) + '  ' + cd('gray', time));
      } else {
        push('  ' + c(s.color, s.dot + ' ') + cd('gray', type + ' ') + cd('gray', feature) + '  ' + cd('gray', time));
      }
    }
  }

  // ── TODOs ──
  if (todos.length > 0) {
    blank();
    sep('TODOs (' + todos.length + ')');
    const limit = 3;
    const shown = todos.slice(0, limit);
    for (const t of shown) {
      const hi = t.priority === 'high';
      const prefix = hi ? c('red', ' ! ') : c('gray', ' · ');
      push(prefix + cd('gray', trunc(typeof t.text === 'string' ? t.text : '', cols - 6)));
    }
    if (todos.length > limit) {
      push(cd('gray', '   ↓ ' + (todos.length - limit) + ' more'));
    }
  }

  return { lines, regions };
}

function autoScroll(bodyLines, regions, viewportH) {
  let targetStart = -1, targetEnd = -1;
  for (const r of regions) {
    if (r.idx === selectedIdx) {
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

  // Map body regions to terminal rows for hit-testing and animation
  cardRegions = [];
  for (const r of regions) {
    const screenLine = r.bodyLine - scrollOffset;
    if (screenLine + r.h <= 0 || screenLine >= viewportH) continue;
    cardRegions.push({
      idx: r.idx,
      y: headerH + screenLine + 1, // 1-based terminal row
      h: r.h,
      type: r.type,
    });
  }

  // Build single output buffer
  const out = [];
  out.push(ESC + 'H');
  out.push(ESC + '?25l');

  // Header (pinned)
  for (let i = 0; i < headerH; i++) {
    const vis = stripAnsi(header[i]);
    out.push(header[i] + ' '.repeat(Math.max(0, cols - vis.length)));
    out.push('\r\n');
  }

  // Body viewport (scrollable)
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

  // Footer (pinned)
  let footerText;
  if (flashMessage) {
    footerText = BOLD + COLOR.green + ' ✓ ' + flashMessage + RESET;
  } else {
    const hints = expandedIdx >= 0
      ? '[↑↓] select  [⏎] toggle  [R] resume  [ESC] close  [r] refresh  [q] quit'
      : '[↑↓] select  [⏎] open  [R] resume  [r] refresh  [q] quit';
    footerText = DIM + COLOR.gray + trunc(hints, cols) + RESET;
  }
  const footerVis = stripAnsi(footerText);
  out.push(footerText + ' '.repeat(Math.max(0, cols - footerVis.length)));

  process.stdout.write(out.join(''));
}

// ── Input handling ──────────────────────────────────────────────────────

function totalItems() {
  return workers.length + completed.length;
}

function signalSelection() {
  const run = getSelectedRun();
  if (run) writeObserverSignal(run);
}

function selectPrev() {
  if (selectedIdx > 0) { selectedIdx--; signalSelection(); draw(); }
}

function selectNext() {
  if (selectedIdx < totalItems() - 1) { selectedIdx++; signalSelection(); draw(); }
}

function toggleExpand(idx) {
  if (idx === undefined) idx = selectedIdx;
  if (idx < 0 || idx >= totalItems()) return;
  if (expandedIdx === idx) {
    expandedIdx = -1;
  } else {
    expandedIdx = idx;
    selectedIdx = idx;
  }
  signalSelection();
  draw();
}

function collapseExpand() {
  if (expandedIdx >= 0) { expandedIdx = -1; draw(); }
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

function sendToChat() {
  const run = getSelectedRun();
  if (!run) return;
  writeObserverSignal(run);
  flash('Context sent → type in Claude Code');
}

function resumeWorker() {
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

// Lightweight animation: only update icon characters via single write
function drawAnimOnly() {
  animFrame++;
  const parts = [];
  for (const region of cardRegions) {
    if (region.type !== 'worker') continue;
    const run = workers[region.idx];
    if (!run) continue;
    const s = statusOf(run);
    const icon = animIcon(run, animFrame);
    // region.y = box top border row (1-based); icon is one row below
    parts.push(ESC + (region.y + 1) + ';3H' + (COLOR[s.color] || '') + icon + RESET);
  }
  if (parts.length > 0) {
    process.stdout.write(parts.join(''));
  }
}

// ── Main ────────────────────────────────────────────────────────────────

process.stdout.write(ESC + '?1049h'); // enter alternate screen buffer
process.stdout.write(ESC + '?25l');   // hide cursor
term.grabInput({ mouse: 'button', focus: true });

term.on('key', (name) => {
  switch (name) {
    case 'q': case 'Q': case 'CTRL_C': quit(); break;
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
      const idx = hitTest(data.y);
      if (idx >= 0) {
        toggleExpand(idx);
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

// Initial load + draw
refresh();
draw();

// Periodic data refresh + full redraw
setInterval(() => { refresh(); draw(); }, REFRESH_MS);

// Animation tick (icons only — single write, no full redraw)
setInterval(drawAnimOnly, 150);

// Terminal resize
term.on('resize', () => { draw(); });
