#!/usr/bin/env node
// FORGE terminal observer — worktree conductor dashboard (terminal-kit).
//
// Run:  node scripts/forge-observer.mjs   (or use observer.bat)
// Quit: q / Ctrl+C  |  Navigate: ↑↓ / j k / scroll  |  Click: expand  |  Refresh: r
// Tabs: 1=Sessions  2=TODOs  3=Notes  4=SPECS

import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { estimateCost, modelTier } from './lib/model-pricing.js';

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
  process.stderr.write('[forge-observer] Restart your Claude Code session to install dependencies automatically.\n');
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
  { key: '4', label: 'SPECS' },
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

function loadProjectConfig(projectDir) {
  try {
    const raw = readFileSync(join(projectDir, '.pipeline', 'project.json'), 'utf8');
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function loadAgentHealth(projectDir) {
  const result = {
    totalDispatches: 0,
    successRate: 0,
    truncatedCount: 0,
    noVerdictCount: 0,
    byAgent: {},
    mismatches: [],
  };
  try {
    const runsDir = join(projectDir, '.pipeline', 'runs');
    let runDirs;
    try {
      runDirs = readdirSync(runsDir);
    } catch (_) { return result; }
    for (const runId of runDirs) {
      let run;
      try {
        const raw = readFileSync(join(runsDir, runId, 'run.json'), 'utf8');
        run = JSON.parse(raw);
      } catch (_) { continue; }
      if (!Array.isArray(run.agents)) continue;
      for (const agent of run.agents) {
        const rawType = typeof agent.agentType === 'string' ? agent.agentType : '';
        const agentType = rawType.replace(/^forge:/, '');
        if (!agentType) continue;
        result.totalDispatches++;
        const isTruncated = agent.outcome === null && agent.completedAt === null;
        const isNoVerdict = agent.outcome === null && agent.completedAt !== null;
        if (isTruncated) result.truncatedCount++;
        if (isNoVerdict) result.noVerdictCount++;
        if (!result.byAgent[agentType]) {
          result.byAgent[agentType] = { dispatches: 0, truncated: 0, noVerdict: 0 };
        }
        result.byAgent[agentType].dispatches++;
        if (isTruncated) result.byAgent[agentType].truncated++;
        if (isNoVerdict) result.byAgent[agentType].noVerdict++;
      }

      // Locked vs dispatched comparison
      if (run.stages && typeof run.stages === 'object') {
        const locked = new Set();
        for (const stage of Object.values(run.stages)) {
          if (Array.isArray(stage.agents)) {
            for (const a of stage.agents) locked.add(a);
          }
        }
        const dispatched = new Set(
          run.agents
            .map((a) => (typeof a.agentType === 'string' ? a.agentType : '').replace(/^forge:/, ''))
            .filter(Boolean),
        );
        const unlocked = [...dispatched].filter((a) => !locked.has(a));
        const missing = [...locked].filter((a) => !dispatched.has(a));
        if (unlocked.length > 0 || missing.length > 0) {
          result.mismatches.push({
            runId: run.runId || runId,
            updatedAt: run.updatedAt || run.createdAt || '',
            unlocked,
            missing,
          });
        }
      }
    }
  } catch (_) {}
  const completed = result.totalDispatches - result.truncatedCount - result.noVerdictCount;
  result.successRate = result.totalDispatches > 0
    ? Math.round((completed / result.totalDispatches) * 100)
    : 0;
  return result;
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

const HEARTBEAT_STALE_MS = 300_000;


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

let escalations = {};

function isLost(run) {
  if (run.status !== 'running') return false;
  const logPath = join(PROJECT_DIR, '.pipeline', 'worker-logs', run.runId + '.log');
  try {
    const st = statSync(logPath);
    return (Date.now() - st.mtimeMs) > HEARTBEAT_STALE_MS;
  } catch (_) {
    // Log file does not exist — fall back to run.updatedAt.
    const ref = run.updatedAt ? Date.parse(run.updatedAt) : 0;
    if (!ref) return false;
    return (Date.now() - ref) > HEARTBEAT_STALE_MS;
  }
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
      'planning': { stage: 2, label: 'planning' },
      'reviewing': { stage: 4, label: 'reviewers' },
      'gate1': { stage: 5, label: 'gate1' },
    },
  },
  implement: {
    totalStages: 6, steps: {
      'implementing': { stage: 3, label: 'implementing' },
      'reviewing': { stage: 5, label: 'reviewers' },
      'gate2': { stage: 6, label: 'gate2' },
    },
  },
  apply: {
    totalStages: 6, steps: {
      'applying': { stage: 4, label: 'applying' },
      'commit': { stage: 5, label: 'commit approval' },
    },
  },
  debug: {
    totalStages: 4, steps: {
      'debugging': { stage: 2, label: 'debugging' },
      'reviewing': { stage: 3, label: 'reviewers' },
      'gate2': { stage: 4, label: 'gate2' },
    },
  },
  refactor: {
    totalStages: 4, steps: {
      'refactoring': { stage: 2, label: 'refactoring' },
      'reviewing': { stage: 3, label: 'reviewers' },
      'gate2': { stage: 4, label: 'gate2' },
    },
  },
  research: {
    totalStages: 2, steps: {
      'researching': { stage: 2, label: 'researching' },
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
  if (run.status === 'completed') {
    return { bar: renderBar(config.totalStages, config.totalStages), label: 'completed' };
  }
  if (run.status === 'failed') {
    return { bar: renderBar(0, config.totalStages), label: 'failed' };
  }
  if (run.status === 'discarded') {
    return { bar: renderBar(0, config.totalStages), label: 'discarded' };
  }
  if (run.actionNeeded) {
    return { bar: renderBar(config.totalStages, config.totalStages), label: run.actionNeeded };
  }
  if (run.status === 'gate-pending' && run.gateState) {
    const gate = run.gateState.gate;
    const stepInfo = config.steps[gate] || { stage: config.totalStages };
    if (run.gateState.status === 'approved') {
      const nextLabel = run.actionNeeded ? run.actionNeeded
        : gate === 'gate1' ? 'approved — implementing'
        : gate === 'gate2' ? 'approved — applying'
        : 'approved';
      return { bar: renderBar(stepInfo.stage, config.totalStages), label: nextLabel };
    }
    const label = gate === 'gate1' ? 'plan approval needed'
      : gate === 'commit' ? 'commit approval needed'
      : 'approval needed';
    return { bar: renderBar(stepInfo.stage, config.totalStages), label };
  }
  const label = run.stageLabel || 'running';
  const stepInfo = config.steps[label] || { stage: 1, label };
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

const FONT_V1 = {
  F: ['████', '█   ', '███ ', '█   ', '█   '],
  O: [' ██ ', '█  █', '█  █', '█  █', ' ██ '],
  R: ['███ ', '█  █', '███ ', '█ █ ', '█  █'],
  G: [' ███', '█   ', '█ ██', '█  █', ' ███'],
  E: ['████', '█   ', '███ ', '█   ', '████'],
};

const BANNER_V2_RAW = [
  '███████╗ ██████╗ ██████╗  ██████╗ ███████╗',
  '██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝',
  '█████╗  ██║   ██║██████╔╝██║  ███╗█████╗  ',
  '██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝  ',
  '██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗',
  '╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝',
];

function buildBannerV1() {
  const X_ = RESET;
  const colors = [[255, 205, 50], [255, 140, 30], [215, 45, 25]];
  const word = 'FORGE', gap = '  ';
  const totalW = word.length * 4 + (word.length - 1) * gap.length;
  const txt = [];
  for (let row = 0; row < 5; row++) {
    let line = '', col = 0;
    for (let i = 0; i < word.length; i++) {
      const chars = FONT_V1[word[i]][row];
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
  return txt.map(l => '  ' + l);
}

function buildBannerV2() {
  const X_ = RESET;
  const colors = [[255, 205, 50], [255, 140, 30], [215, 45, 25]];
  return BANNER_V2_RAW.map(raw => {
    let line = '';
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === ' ') {
        line += ' ';
      } else {
        const t = raw.length > 1 ? i / (raw.length - 1) : 0;
        const seg = Math.min(Math.floor(t * (colors.length - 1)), colors.length - 2);
        const rc = lerp(colors[seg], colors[seg + 1], t * (colors.length - 1) - seg);
        line += rgb(rc[0], rc[1], rc[2]) + ch + X_;
      }
    }
    return '  ' + line;
  });
}

const BANNER = buildBannerV2();

// ── State ───────────────────────────────────────────────────────────────

let state = null;
let todos = [];
let notes = [];
let usage = null;
let projectConfig = null;
let agentHealth = null;
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

const REVIEWABLE_TYPES = new Set(['research', 'ideate']);
function isUnacknowledgedResearch(run) {
  return REVIEWABLE_TYPES.has(run.pipelineType) && run.status === 'completed' && !run.acknowledged;
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

async function refresh() {
  try {
    state = await buildDashboardState(PROJECT_DIR);
    const PRI = { high: 0, medium: 1, low: 2 };
    todos = loadOpenTodos(PROJECT_DIR).sort((a, b) => {
      const pa = PRI[a.priority] ?? 3;
      const pb = PRI[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      return (a.addedAt || 0) - (b.addedAt || 0);
    });
    notes = loadNotes(PROJECT_DIR);
    usage = loadUsage(PROJECT_DIR);
    projectConfig = loadProjectConfig(PROJECT_DIR);
    agentHealth = loadAgentHealth(PROJECT_DIR);
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
        const runningStage = merged.stages ? Object.entries(merged.stages).find(([_, v]) => v && v.status === 'running')?.[0] : null;
        const stageSuffix = (runningStage && runningStage !== merged.pipelineType) ? ' → ' + runningStage : '';
        detailRows.push(['Pipeline', (merged.pipelineType || '') + (merged.mode && merged.pipelineType !== 'research' ? ' (' + merged.mode + ')' : '') + stageSuffix]);
        detailRows.push(['Status', (merged.status || '') + (merged.stageLabel ? ' — ' + merged.stageLabel : '')]);
        // Phase indicator — only when phases are present. Shows "X/Y" plus the
        // currently-running phase label for quick context. Pending/blocked
        // phases are not summarised here (Stage 2 of e7ebd631 adds full per-phase rows).
        if (Array.isArray(merged.phases) && merged.phases.length > 0) {
          const total = merged.phases.length;
          const completed = merged.phases.filter(p => p.status === 'completed').length;
          const running = merged.phases.find(p => p.status === 'running');
          const blocked = merged.phases.find(p => p.status === 'blocked');
          let phaseStr = completed + '/' + total;
          if (running) phaseStr += ' (running ' + (running.label || ('phase ' + (running.index + 1))) + ')';
          else if (blocked) phaseStr += ' (blocked: ' + (blocked.label || ('phase ' + (blocked.index + 1))) + ')';
          detailRows.push(['Phases', phaseStr]);
        }
        // Branch row only when branchName uses a non-default prefix (default
        // `forge/<runId>` is redundant with the runId already shown in the header).
        if (merged.branchName && !merged.branchName.startsWith('forge/')) detailRows.push(['Branch', merged.branchName]);
        // Worktree row removed — basename always equals runId, redundant with header.
        detailRows.push(['Created', fmtTimestamp(merged.createdAt)]);
        detailRows.push(['Updated', fmtTimestamp(merged.updatedAt)]);
        const dur = fmtDuration(merged.createdAt, merged.status === 'running' ? new Date().toISOString() : merged.updatedAt);
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
      const dur = fmtDuration(run.createdAt, run.status === 'running' ? new Date().toISOString() : run.updatedAt);
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
  const MAX = 36;
  const periodIdx = stripped.indexOf('. ');
  const colonIdx = stripped.indexOf(': ');
  const dashIdx = stripped.indexOf(' — ');
  const breaks = [periodIdx, colonIdx, dashIdx].filter(i => i > 0 && i <= MAX);
  const best = breaks.length > 0 ? Math.min(...breaks) : -1;
  if (best > 0) return stripped.slice(0, best);
  if (stripped.length <= MAX) return stripped;
  const cut = stripped.lastIndexOf(' ', MAX);
  return cut > 10 ? stripped.slice(0, cut) : stripped.slice(0, MAX);
}

function todoSummary(t) {
  if (t.summary) return t.summary;
  const text = typeof t.text === 'string' ? t.text : '';
  const title = todoTitle(t);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  const body = lines.join(' ').replace(/^(\[?[A-Z]+\]?):\s*/i, '');
  const titleEnd = body.indexOf(title);
  const skipTo = titleEnd >= 0 ? titleEnd + title.length : 0;
  const afterTitle = body.slice(skipTo);
  const nextSentence = afterTitle.match(/[.!?]\s+(.*)/s);
  const rest = nextSentence ? nextSentence[1].trim() : afterTitle.replace(/^[^a-zA-Z]*/, '').trim();
  if (!rest) return '';
  const sentences = rest.split(/(?<=[.!?])\s+(?=[A-Z(])/).filter(Boolean);
  let sum = '';
  for (const s of sentences) {
    const trimmed = s.trim();
    const candidate = sum ? sum + ' ' + trimmed : trimmed;
    if (sum && candidate.length > 160) break;
    sum = candidate;
    if (sum.length >= 80) break;
  }
  return sum || rest.slice(0, 160);
}

function buildTodosTab(cols) {
  const inner = Math.max(20, cols - 4);
  const lines = [];
  const regions = [];
  const open = todos;

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

  if (open.length === 0) {
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
      // Word-wrap summary into detail rows
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

// ── SPECS tab helpers ────────────────────────────────────────────────────

const REVIEWER_AGENT_TYPES = new Set([
  'reviewer-safety', 'reviewer-boundary', 'reviewer-logic',
  'reviewer-style', 'reviewer-performance',
]);

/** Returns the N most recent run.json objects (any status), sorted by run.json mtime desc. */
function loadRecentRunsSorted(projectDir, limit = 10) {
  const runsDir = join(projectDir, '.pipeline', 'runs');
  const results = [];
  try {
    for (const runId of readdirSync(runsDir)) {
      const runPath = join(runsDir, runId, 'run.json');
      try {
        const mtime = statSync(runPath).mtimeMs;
        const run = JSON.parse(readFileSync(runPath, 'utf8'));
        results.push({ run, mtime });
      } catch (_) {}
    }
  } catch (_) {}
  return results.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map((r) => r.run);
}

/** Returns up to N entries {run, classification} for runs that have classification.json, mtime desc. */
function loadRunsWithClassification(projectDir, limit = 5) {
  const runsDir = join(projectDir, '.pipeline', 'runs');
  const results = [];
  try {
    for (const runId of readdirSync(runsDir)) {
      const classPath = join(runsDir, runId, 'classification.json');
      if (!existsSync(classPath)) continue;
      try {
        const mtime = statSync(classPath).mtimeMs;
        const run = JSON.parse(readFileSync(join(runsDir, runId, 'run.json'), 'utf8'));
        const classification = JSON.parse(readFileSync(classPath, 'utf8'));
        results.push({ run, classification, mtime });
      } catch (_) {}
    }
  } catch (_) {}
  return results.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

// ── Tab 4: SPECS ────────────────────────────────────────────────────────

function buildSpecsTab(cols) {
  const lines = [];
  lines.push('');

  // ── Project section ────────────────────────────────────────────────────
  lines.push('  ' + cb('cyan', 'Project'));
  if (!projectConfig) {
    lines.push(c('gray', '    No project config available'));
    lines.push(c('gray', '    Run /forge:init or create .pipeline/project.json'));
  } else {
    if (projectConfig.name) {
      lines.push('    ' + c('gray', 'Name:   ') + c('white', String(projectConfig.name)));
    }
    if (projectConfig.description) {
      lines.push('    ' + c('gray', 'Desc:   ') + c('white', trunc(String(projectConfig.description), Math.max(20, cols - 16))));
    }
    const stacks = projectConfig.techStackLabels || projectConfig.techStacks;
    if (Array.isArray(stacks) && stacks.length > 0) {
      lines.push('    ' + c('gray', 'Stacks: ') + c('white', stacks.join(', ')));
    }
  }
  lines.push('');

  // ── Usage section ──────────────────────────────────────────────────────
  lines.push('  ' + cb('cyan', 'Usage'));
  if (!usage || !usage.providers || Object.keys(usage.providers).length === 0) {
    lines.push(c('gray', '    No usage data available'));
    lines.push(c('gray', '    Usage tracking activates during pipeline runs'));
  } else {
    for (const [providerId, provider] of Object.entries(usage.providers)) {
      lines.push('    ' + cb('white', providerId));
      lines.push('      ' + c('gray', 'Requests: ') + c('white', String(provider.requestCount ?? 0)));
      lines.push('      ' + c('gray', 'Tokens:   ') + c('white', Number(provider.tokenCount ?? 0).toLocaleString()));
      if (provider.lastUsed) {
        lines.push('      ' + c('gray', 'Last:     ') + cd('gray', fmtRel(provider.lastUsed)));
      }
      if (provider.models && typeof provider.models === 'object') {
        for (const [modelId, model] of Object.entries(provider.models)) {
          lines.push('      ' + c('gray', '  ' + trunc(modelId, Math.max(10, cols - 28)) + ': ') +
            c('white', String(model.requestCount ?? 0)) + c('gray', ' req  ') +
            c('white', Number(model.tokenCount ?? 0).toLocaleString()) + c('gray', ' tok'));
        }
      }
    }
  }
  lines.push('');

  // ── Agent Health section ───────────────────────────────────────────────
  lines.push('  ' + cb('cyan', 'Agent Health'));
  if (!agentHealth || agentHealth.totalDispatches === 0) {
    lines.push(c('gray', '    No agent dispatch data available'));
    lines.push(c('gray', '    Agents appear here after pipeline runs'));
  } else {
    lines.push('    ' + c('gray', 'Dispatches: ') + c('white', String(agentHealth.totalDispatches)));
    lines.push('    ' + c('gray', 'Success:    ') + c(agentHealth.successRate >= 80 ? 'green' : 'yellow', agentHealth.successRate + '%'));
    if (agentHealth.truncatedCount > 0) {
      lines.push('    ' + c('gray', 'Truncated:  ') + c('red', String(agentHealth.truncatedCount)));
    }
    if (agentHealth.noVerdictCount > 0) {
      lines.push('    ' + c('gray', 'No-verdict: ') + c('yellow', String(agentHealth.noVerdictCount)));
    }
    const topAgents = Object.entries(agentHealth.byAgent)
      .sort((a, b) => b[1].dispatches - a[1].dispatches)
      .slice(0, 5);
    if (topAgents.length > 0) {
      lines.push('');
      lines.push('    ' + c('gray', 'Top agents:'));
      for (const [agentType, stats] of topAgents) {
        const label = trunc(agentType, Math.max(16, cols - 32));
        const flags = [];
        if (stats.truncated > 0) flags.push(c('red', stats.truncated + ' trunc'));
        if (stats.noVerdict > 0) flags.push(c('yellow', stats.noVerdict + ' nv'));
        const flagStr = flags.length > 0 ? '  ' + flags.join(' ') : '';
        lines.push('      ' + c('white', label) + c('gray', '  ' + stats.dispatches + ' runs') + flagStr);
      }
    }
  }

  // ── Locked vs Dispatched ────────────────────────────────────────────
  if (agentHealth && agentHealth.mismatches.length > 0) {
    lines.push('');
    lines.push('  ' + cb('cyan', 'Locked vs Dispatched'));
    const recent = agentHealth.mismatches
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 5);
    for (const mm of recent) {
      lines.push('    ' + c('gray', mm.runId));
      if (mm.unlocked.length > 0) {
        lines.push('      ' + c('red', 'unlocked: ') + c('white', mm.unlocked.join(', ')));
      }
      if (mm.missing.length > 0) {
        lines.push('      ' + c('yellow', 'missing:  ') + c('white', mm.missing.join(', ')));
      }
    }
  }

  // ── Token Attribution ────────────────────────────────────────────────
  lines.push('');
  lines.push('  ' + cb('cyan', 'Token Attribution'));
  {
    const recentRuns = loadRecentRunsSorted(PROJECT_DIR, 10);
    const completedRuns = recentRuns.filter((r) => r.status === 'completed').slice(0, 5);
    if (completedRuns.length === 0) {
      lines.push(c('gray', '    No run data'));
    } else {
      // usage.json has provider-level totals only — per-run token counts are unavailable
      // until per-run tracking is added (deferred). Show agent dispatch breakdown instead.
      for (const run of completedRuns) {
        const label = trunc(run.feature || run.runId, Math.max(16, cols - 28));
        lines.push('    ' + c('white', run.runId) + c('gray', '  ' + label));
        if (Array.isArray(run.agents) && run.agents.length > 0) {
          const byType = {};
          for (const agent of run.agents) {
            const t = (agent.agentType || '').replace(/^forge:/, '');
            if (t) byType[t] = (byType[t] || 0) + 1;
          }
          const parts = Object.entries(byType)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([t, n]) => c('gray', t + ':') + c('white', String(n)));
          lines.push('      ' + parts.join(c('gray', '  ')));
        }
      }
      const totalTok = (usage && usage.providers)
        ? Object.values(usage.providers).reduce((s, p) => s + (Number(p.tokenCount) || 0), 0)
        : 0;
      if (totalTok > 0) {
        lines.push('    ' + c('gray', 'Provider total (all time): ') + c('white', totalTok.toLocaleString() + ' tok'));
      }
      lines.push(c('gray', '    Per-run tok counts require per-run tracking (deferred)'));
    }
  }

  // ── Cost (est.) ──────────────────────────────────────────────────────
  lines.push('');
  lines.push('  ' + cb('cyan', 'Cost (est.)'));
  if (!usage || !usage.providers || Object.keys(usage.providers).length === 0) {
    lines.push(c('gray', '    No usage data'));
  } else {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let grandTotal = 0;
    for (const [providerId, provider] of Object.entries(usage.providers)) {
      const lastUsedMs = provider.lastUsed ? new Date(provider.lastUsed).getTime() : 0;
      if (lastUsedMs > 0 && lastUsedMs < sevenDaysAgo) continue;
      let providerUsd = 0;
      if (provider.models && typeof provider.models === 'object') {
        for (const [modelId, model] of Object.entries(provider.models)) {
          providerUsd += estimateCost(Number(model.tokenCount) || 0, modelId);
        }
      } else {
        // No per-model breakdown — use provider total at sonnet blended rate
        providerUsd = estimateCost(Number(provider.tokenCount) || 0, 'claude-sonnet-4-5');
      }
      grandTotal += providerUsd;
      lines.push('    ' + cb('white', providerId) + c('gray', '  $') + c('white', providerUsd.toFixed(4)));
    }
    lines.push('    ' + c('gray', 'Total (7 days): ') + cb('white', '$' + grandTotal.toFixed(4)));
    lines.push(c('gray', '    Rates: opus $15/$75, sonnet $3/$15, haiku $0.80/$4 per 1M tok'));
  }

  // ── Classifier Audit ─────────────────────────────────────────────────
  lines.push('');
  lines.push('  ' + cb('cyan', 'Classifier Audit'));
  {
    const auditEntries = loadRunsWithClassification(PROJECT_DIR);
    if (auditEntries.length === 0) {
      lines.push(c('gray', '    No classified runs yet'));
      lines.push(c('gray', '    Appears after forge_create_run with a classificationId'));
    } else {
      for (const { run, classification } of auditEntries) {
        const predicted = new Set(Array.isArray(classification.reviewers) ? classification.reviewers : []);
        const actual = new Set(
          (run.agents || [])
            .map((a) => (a.agentType || '').replace(/^forge:/, ''))
            .filter((t) => REVIEWER_AGENT_TYPES.has(t)),
        );
        const isMatch = [...predicted].every((r) => actual.has(r)) && [...actual].every((r) => predicted.has(r));
        const matchFlag = isMatch ? c('green', '✓ match') : c('yellow', '≠ mismatch');
        const riskColor = classification.riskLevel === 'high' ? 'red'
          : classification.riskLevel === 'medium' ? 'yellow' : 'green';
        lines.push('    ' + c('gray', run.runId) + '  ' + matchFlag +
          '  ' + c(riskColor, classification.riskLevel || '?'));
        const predList = [...predicted].join(', ') || 'none';
        const actList = [...actual].join(', ') || 'none';
        lines.push('      ' + c('gray', 'pred: ') + c('white', trunc(predList, Math.max(20, cols - 18))));
        lines.push('      ' + c('gray', 'act:  ') + c('white', trunc(actList, Math.max(20, cols - 18))));
      }
    }
  }

  return { lines, regions: [] };
}

// ── Build body (dispatches to active tab) ───────────────────────────────

function buildBody(cols) {
  switch (currentTab) {
    case 0: return buildSessionsTab(cols);
    case 1: return buildTodosTab(cols);
    case 2: return buildNotesTab(cols);
    case 3: return buildSpecsTab(cols);
    default: return { lines: [], regions: [] };
  }
}

function activeSelectedIdx() {
  if (currentTab === 1) return todoSelectedIdx;
  return selectedIdx;
}

function autoScroll(bodyLines, regions, viewportH) {
  if (currentTab !== 0 && currentTab !== 1) {
    scrollOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, bodyLines - viewportH)));
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
      modeHints = '[↑↓] scroll';
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
  } else {
    if (scrollOffset > 0) { scrollOffset--; draw(); }
  }
}

function selectNext() {
  if (currentTab === 0) {
    if (selectedIdx < workers.length + completed.length - 1) { selectedIdx++; signalSelection(); draw(); }
  } else if (currentTab === 1) {
    if (todoSelectedIdx < todos.length - 1) { todoSelectedIdx++; signalSelection(); draw(); }
  } else {
    scrollOffset++; draw();
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

/**
 * Resolve wt.exe: check PATH first, then the Microsoft Store App Execution
 * Alias location (%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe).
 *
 * Returns 'wt.exe' if found on PATH, the Store-app path if found there,
 * or null if not found in either location. Never throws.
 */
function resolveWtExe() {
  try {
    execSync('where wt.exe', { stdio: 'ignore', timeout: 2000 });
    return 'wt.exe';
  } catch (_) {
    // Not on PATH — try Store-app alias.
  }
  try {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const storePath = join(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe');
      if (existsSync(storePath)) {
        return storePath;
      }
    }
  } catch (_) {
    // Ignore unexpected errors.
  }
  return null;
}

function resumeWorker() {
  if (currentTab !== 0) return;
  const run = getSelectedRun();
  if (!run || !run.runId) return;
  const workerName = 'worker-' + run.runId;
  const wtDir = run.worktreePath || PROJECT_DIR;
  const wtExe = resolveWtExe();
  if (wtExe === null) {
    flash('claude --resume ' + workerName);
    return;
  }
  // When wt.exe was found via the Store-app alias, ensure the WindowsApps
  // directory is on PATH so the App Execution Alias resolves correctly.
  const spawnEnv = Object.assign({}, process.env);
  if (wtExe !== 'wt.exe' && process.env.LOCALAPPDATA) {
    const aliasDir = process.env.LOCALAPPDATA + '\\Microsoft\\WindowsApps';
    spawnEnv.PATH = aliasDir + (process.env.PATH ? ';' + process.env.PATH : '');
  }
  try {
    const child = spawn('wt.exe', [
      '-w', '0', 'nt',
      '-d', wtDir,
      '--title', (run.feature || run.runId).slice(0, 60),
      '--', 'claude', '--resume', workerName,
    ], { detached: true, stdio: 'ignore', env: spawnEnv });
    child.unref();
    flash('Resumed ' + run.runId + ' in new tab');
  } catch (err) {
    flash('Resume failed: ' + err.message);
  }
}

function quit() {
  try { const p = join(PROJECT_DIR, '.pipeline', 'observer.pid'); if (existsSync(p)) unlinkSync(p); } catch (_) {}
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

// Write our own PID so observer-autosplit.js can detect we're already running.
// The hook's spawn PID is unreliable (wt.exe exits immediately after delegating).
try {
  const pidDir = join(PROJECT_DIR, '.pipeline');
  if (existsSync(pidDir)) writeFileSync(join(pidDir, 'observer.pid'), String(process.pid) + '\n', 'utf8');
} catch (_) {}

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
    case 'r': refresh().then(draw); break;
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

await refresh();
draw();
signalSelection();

setInterval(() => { refresh().then(draw); }, REFRESH_MS);
setInterval(drawAnimOnly, 150);
term.on('resize', () => { draw(); });
