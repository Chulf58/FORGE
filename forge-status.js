#!/usr/bin/env node

// FORGE Status Line — emoji icons, progress bars, descriptive status.
// Configured via Claude Code's statusLine setting.

const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const meta = JSON.parse(input);
    const cwd = meta.cwd || process.cwd();
    process.stdout.write(buildStatusLine(cwd));
  } catch {
    process.stdout.write('FORGE');
  }
});

function buildStatusLine(projectDir) {
  const sessions = [];

  // Main project session
  const main = readSession(projectDir, path.basename(projectDir));
  if (main) sessions.push(main);

  // Worktree sessions
  const wtDir = path.join(projectDir, '.worktrees');
  if (fs.existsSync(wtDir)) {
    try {
      const dirs = fs.readdirSync(wtDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .slice(0, 5);
      for (const d of dirs) {
        const s = readSession(path.join(wtDir, d.name), d.name);
        if (s) sessions.push(s);
      }
    } catch {}
  }

  if (sessions.length === 0) return 'FORGE';

  return sessions.map(formatSession).join(' │ ');
}

function readSession(dir, name) {
  const runPath = path.join(dir, '.pipeline', 'run-active.json');
  const gatePath = path.join(dir, '.pipeline', 'gate-pending.json');

  let mode = null;
  let startedAt = null;
  let gateStatus = null;
  let wave = null;
  let waveTotal = null;

  if (fs.existsSync(runPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(runPath, 'utf8'));
      mode = data.mode || 'running';
      startedAt = data.startedAt || null;
      wave = data.wave || null;
      waveTotal = data.waveTotal || null;
    } catch {}
  }

  if (fs.existsSync(gatePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
      if (data.status === 'pending') {
        gateStatus = data.gate;
      }
    } catch {}
  }

  if (!mode && !gateStatus) return null;

  return { name, mode, startedAt, gateStatus, wave, waveTotal };
}

function formatSession(s) {
  // Gate pending — needs approval
  if (s.gateStatus) {
    return `⏳ ${s.name} ⊘ needs approval`;
  }

  // Active run
  const { icon, bar, label } = modeToDisplay(s);
  return `${icon} ${s.name} ${bar} ${label}`;
}

function modeToDisplay(s) {
  const mode = s.mode || 'running';

  // Wave progress if available
  if (s.wave && s.waveTotal) {
    const filled = s.wave;
    const total = s.waveTotal;
    return {
      icon: '🔨',
      bar: renderBar(filled, total),
      label: `wave ${filled}/${total}`
    };
  }

  switch (mode) {
    case 'plan feature':
      return { icon: '🔍', bar: renderBar(1, 4), label: 'planning' };
    case 'implement feature':
      return { icon: '🔨', bar: renderBar(2, 4), label: 'implementing' };
    case 'apply feature':
      return { icon: '🔨', bar: renderBar(3, 4), label: 'applying' };
    case 'debug':
      return { icon: '🐛', bar: renderBar(1, 4), label: 'debugging' };
    case 'refactor':
      return { icon: '♻️', bar: renderBar(1, 4), label: 'refactoring' };
    default:
      return { icon: '🔍', bar: renderBar(1, 4), label: mode };
  }
}

function renderBar(filled, total) {
  return '▓'.repeat(Math.min(filled, total)) + '░'.repeat(Math.max(0, total - filled));
}
