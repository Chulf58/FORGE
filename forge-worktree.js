#!/usr/bin/env node

// FORGE Worktree Manager — create, list, merge, and cleanup git worktrees.
// Called by the orchestrator via Bash.
//
// Usage:
//   node forge-worktree.js create <slug>     → creates .worktrees/<slug> with branch forge/<slug>
//   node forge-worktree.js list              → lists active worktrees as JSON
//   node forge-worktree.js merge <slug>      → merges forge/<slug> into current branch, removes worktree
//   node forge-worktree.js cleanup           → removes all worktrees and their branches

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cmd = process.argv[2];
const slug = process.argv[3];

const WORKTREE_DIR = '.worktrees';

function run(command, opts = {}) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
  } catch (e) {
    if (opts.allowFail) return '';
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

function ensureGitRepo() {
  try {
    run('git rev-parse --git-dir');
  } catch {
    console.error('Not a git repository.');
    process.exit(1);
  }
}

function create() {
  if (!slug) { console.error('Usage: forge-worktree.js create <slug>'); process.exit(1); }

  ensureGitRepo();

  const wtPath = path.join(WORKTREE_DIR, slug);
  const branch = `forge/${slug}`;

  if (fs.existsSync(wtPath)) {
    console.log(JSON.stringify({ ok: true, path: wtPath, branch, exists: true }));
    return;
  }

  // Create worktree directory
  fs.mkdirSync(WORKTREE_DIR, { recursive: true });

  // Create worktree with new branch from current HEAD
  run(`git worktree add "${wtPath}" -b "${branch}"`);

  // Copy .pipeline/ to worktree so sessions have board, modules, project.json
  const pipelineSrc = '.pipeline';
  const pipelineDst = path.join(wtPath, '.pipeline');
  if (fs.existsSync(pipelineSrc) && !fs.existsSync(pipelineDst)) {
    copyDirSync(pipelineSrc, pipelineDst);
  }

  // Copy docs/ to worktree so sessions have PLAN.md, gotchas, solutions
  const docsSrc = 'docs';
  const docsDst = path.join(wtPath, 'docs');
  if (fs.existsSync(docsSrc) && !fs.existsSync(docsDst)) {
    copyDirSync(docsSrc, docsDst);
  }

  // Copy .claude/ to worktree so sessions have agents and commands
  const claudeSrc = '.claude';
  const claudeDst = path.join(wtPath, '.claude');
  if (fs.existsSync(claudeSrc) && !fs.existsSync(claudeDst)) {
    copyDirSync(claudeSrc, claudeDst);
  }

  // Copy CLAUDE.md
  if (fs.existsSync('CLAUDE.md') && !fs.existsSync(path.join(wtPath, 'CLAUDE.md'))) {
    fs.copyFileSync('CLAUDE.md', path.join(wtPath, 'CLAUDE.md'));
  }

  console.log(JSON.stringify({ ok: true, path: wtPath, branch, exists: false }));
}

function list() {
  ensureGitRepo();

  const wtDir = WORKTREE_DIR;
  if (!fs.existsSync(wtDir)) {
    console.log(JSON.stringify({ worktrees: [] }));
    return;
  }

  const entries = fs.readdirSync(wtDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const wtPath = path.join(wtDir, d.name);
      const branch = `forge/${d.name}`;
      const hasRun = fs.existsSync(path.join(wtPath, '.pipeline', 'run-active.json'));
      const hasGate = fs.existsSync(path.join(wtPath, '.pipeline', 'gate-pending.json'));

      let gateStatus = null;
      if (hasGate) {
        try {
          const gate = JSON.parse(fs.readFileSync(path.join(wtPath, '.pipeline', 'gate-pending.json'), 'utf8'));
          gateStatus = gate.status === 'pending' ? gate.gate : 'approved';
        } catch {}
      }

      return { name: d.name, path: wtPath, branch, running: hasRun, gate: gateStatus };
    });

  console.log(JSON.stringify({ worktrees: entries }));
}

function merge() {
  if (!slug) { console.error('Usage: forge-worktree.js merge <slug>'); process.exit(1); }

  ensureGitRepo();

  const wtPath = path.join(WORKTREE_DIR, slug);
  const branch = `forge/${slug}`;

  if (!fs.existsSync(wtPath)) {
    console.error(`Worktree not found: ${wtPath}`);
    process.exit(1);
  }

  // Merge the branch into current branch
  const currentBranch = run('git branch --show-current');
  const mergeResult = run(`git merge "${branch}" --no-edit`, { allowFail: true });

  // Remove worktree
  run(`git worktree remove "${wtPath}" --force`, { allowFail: true });

  // Delete the branch
  run(`git branch -d "${branch}"`, { allowFail: true });

  console.log(JSON.stringify({
    ok: true,
    merged: branch,
    into: currentBranch,
    worktreeRemoved: true
  }));
}

function cleanup() {
  ensureGitRepo();

  const wtDir = WORKTREE_DIR;
  if (!fs.existsSync(wtDir)) {
    console.log(JSON.stringify({ ok: true, removed: 0 }));
    return;
  }

  const dirs = fs.readdirSync(wtDir, { withFileTypes: true }).filter(d => d.isDirectory());
  let removed = 0;

  for (const d of dirs) {
    const wtPath = path.join(wtDir, d.name);
    const branch = `forge/${d.name}`;
    run(`git worktree remove "${wtPath}" --force`, { allowFail: true });
    run(`git branch -D "${branch}"`, { allowFail: true });
    removed++;
  }

  // Clean up the directory itself if empty
  try {
    if (fs.readdirSync(wtDir).length === 0) fs.rmdirSync(wtDir);
  } catch {}

  // Prune stale worktree references
  run('git worktree prune', { allowFail: true });

  console.log(JSON.stringify({ ok: true, removed }));
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// Dispatch
switch (cmd) {
  case 'create': create(); break;
  case 'list': list(); break;
  case 'merge': merge(); break;
  case 'cleanup': cleanup(); break;
  default:
    console.error('Usage: forge-worktree.js <create|list|merge|cleanup> [slug]');
    process.exit(1);
}
