#!/usr/bin/env node

// FORGE Worktree Manager — create, list, merge, delete, and cleanup git worktrees.
// Called by the orchestrator via Bash.
//
// Usage:
//   node forge-worktree.js create <slug>     → creates .worktrees/<slug> with branch forge/<slug>
//   node forge-worktree.js list              → lists active worktrees as JSON
//   node forge-worktree.js merge <slug>      → merges forge/<slug> into current branch, removes worktree
//   node forge-worktree.js delete <slug>     → removes .worktrees/<slug> and branch forge/<slug> without merging
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

  const currentBranch = run('git branch --show-current');

  // Commit any uncommitted changes in the worktree before merging.
  // Without this, the worktree branch has no new commits and merge is a no-op.
  // Only commit when git status shows real changes — no --allow-empty.
  const wtStatus = run(`git -C "${wtPath}" status --porcelain`, { allowFail: true });
  if (wtStatus) {
    run(`git -C "${wtPath}" add -A`);
    try {
      execSync(`git -C "${wtPath}" commit -m "feat(forge): apply changes"`, {
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e) {
      // Commit failed (pre-commit hook, etc.) — log but continue to merge attempt
      console.error(`[worktree] Pre-merge commit failed: ${e.message}`);
    }
  }

  // Attempt the merge — do NOT use allowFail here, we need to detect failure
  let mergeOk = false;
  try {
    execSync(`git merge "${branch}" --no-edit`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    mergeOk = true;
  } catch (e) {
    // Merge failed (conflict or other error) — abort the merge to restore clean state
    try {
      execSync('git merge --abort', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (_) {
      // --abort can fail if merge wasn't in progress (e.g. fast-forward failure) — ignore
    }
  }

  if (!mergeOk) {
    // Report-only recovery: persist a mergeBlocked marker on the run so
    // existing read surfaces (dashboard, /forge:status, /forge:resume) can
    // tell the user this run is blocked on manual merge resolution instead
    // of leaving it silently stranded. The slug IS the runId (the apply
    // skill calls `forge-worktree.js merge <runId>`).
    try {
      const runJsonPath = path.join('.pipeline', 'runs', slug, 'run.json');
      if (fs.existsSync(runJsonPath)) {
        const runData = JSON.parse(fs.readFileSync(runJsonPath, 'utf8'));
        runData.mergeBlocked = {
          reason: 'Merge failed — conflicts or diverged branches. Worktree and branch preserved for manual resolution.',
          detectedAt: new Date().toISOString(),
        };
        runData.updatedAt = new Date().toISOString();
        fs.writeFileSync(runJsonPath, JSON.stringify(runData, null, 2) + '\n', 'utf8');
      }
    } catch (_) {
      // Best-effort — if we can't persist the marker, the stderr JSON below
      // still informs the current session. The marker just won't survive.
    }

    console.error(JSON.stringify({
      ok: false,
      error: 'Merge failed — conflicts or diverged branches. Worktree and branch preserved for manual resolution.',
      branch,
      into: currentBranch,
      worktreePath: wtPath,
      hint: `Resolve manually: git merge ${branch}`
    }));
    process.exit(1);
  }

  // Merge succeeded — safe to clean up
  run(`git worktree remove "${wtPath}" --force`, { allowFail: true });
  run(`git branch -d "${branch}"`, { allowFail: true });

  console.log(JSON.stringify({
    ok: true,
    merged: branch,
    into: currentBranch,
    worktreeRemoved: true
  }));
}

function deleteWorktree() {
  if (!slug) { console.error('Usage: forge-worktree.js delete <slug>'); process.exit(1); }

  ensureGitRepo();

  const wtPath = path.join(WORKTREE_DIR, slug);
  const branch = `forge/${slug}`;

  if (!fs.existsSync(wtPath)) {
    console.error(JSON.stringify({ ok: false, error: 'Worktree not found: ' + wtPath }));
    process.exit(1);
  }

  run(`git worktree remove "${wtPath}" --force`, { allowFail: true });
  run(`git branch -D "${branch}"`, { allowFail: true });
  run('git worktree prune', { allowFail: true });

  console.log(JSON.stringify({ ok: true, deleted: slug, worktreeRemoved: true, branchDeleted: branch }));
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
  case 'delete': deleteWorktree(); break;
  case 'cleanup': cleanup(); break;
  default:
    console.error('Usage: forge-worktree.js <create|list|merge|delete|cleanup> [slug]');
    process.exit(1);
}
