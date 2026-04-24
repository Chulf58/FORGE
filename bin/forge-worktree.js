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

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cmd = process.argv[2];
const slug = process.argv[3];

const WORKTREE_DIR = path.resolve(process.cwd(), '.worktrees');

// Guard against shell injection via slug — only alphanumeric, hyphens, underscores allowed
function validateSlug(s) {
  if (!s || !/^[a-zA-Z0-9_-]+$/.test(s)) {
    console.error(`[forge-worktree] Invalid slug "${s}": only alphanumeric characters, hyphens, and underscores are allowed.`);
    process.exit(1);
  }
}

function run(binary, args, opts = {}) {
  try {
    return execFileSync(binary, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
  } catch (e) {
    if (opts.allowFail) return '';
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

function ensureGitRepo() {
  try {
    run('git', ['rev-parse', '--git-dir']);
  } catch {
    console.error('Not a git repository.');
    process.exit(1);
  }
}

function create() {
  if (!slug) { console.error('Usage: forge-worktree.js create <slug>'); process.exit(1); }
  validateSlug(slug);

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
  run('git', ['worktree', 'add', wtPath, '-b', branch]);

  // Merge-copy directories: git checkout may have created these from tracked files,
  // but gitignored files (PLAN.md, board.json, etc.) still need copying from main.
  const pipelineSrc = '.pipeline';
  const pipelineDst = path.join(wtPath, '.pipeline');
  if (fs.existsSync(pipelineSrc)) {
    copyDirSync(pipelineSrc, pipelineDst);
  }

  const docsSrc = 'docs';
  const docsDst = path.join(wtPath, 'docs');
  if (fs.existsSync(docsSrc)) {
    copyDirSync(docsSrc, docsDst);
  }

  const claudeSrc = '.claude';
  const claudeDst = path.join(wtPath, '.claude');
  if (fs.existsSync(claudeSrc)) {
    copyDirSync(claudeSrc, claudeDst);
  }

  if (fs.existsSync('CLAUDE.md')) {
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
    .filter(d => d.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(d.name))
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
  validateSlug(slug);

  ensureGitRepo();

  const wtPath = path.join(WORKTREE_DIR, slug);
  const branch = `forge/${slug}`;

  if (!fs.existsSync(wtPath)) {
    console.error(`Worktree not found: ${wtPath}`);
    process.exit(1);
  }

  const currentBranch = run('git', ['branch', '--show-current']);

  // Pre-merge hygiene: reject if main repo has uncommitted changes
  // (exclude .worktrees/ and .pipeline/ — always present during pipeline runs)
  const mainStatus = run('git', ['status', '--porcelain'], { allowFail: true });
  if (mainStatus) {
    const dirtyFiles = mainStatus
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).trim());
    const filteredDirtyFiles = dirtyFiles.filter(
      (f) => !f.startsWith('.worktrees/') && !f.startsWith('.worktrees\\')
        && !f.startsWith('.pipeline/') && !f.startsWith('.pipeline\\')
        && !f.startsWith('docs/') && !f.startsWith('docs\\'),
    );
    if (filteredDirtyFiles.length > 0) {
      console.error(JSON.stringify({
        ok: false,
        error: 'Main repo has uncommitted changes — commit or stash them before merging.',
        dirtyFiles: filteredDirtyFiles,
      }));
      process.exit(1);
    }
  }

  // Reject uncommitted tracked changes in the worktree — the apply skill (Step 8)
  // is responsible for committing. Untracked files (pipeline artifacts like
  // slice-brief.md, triage-dispatch.json) are harmless and should not block.
  const wtStatus = run('git', ['-C', wtPath, 'status', '--porcelain'], { allowFail: true });
  if (wtStatus) {
    const trackedChanges = wtStatus
      .split('\n')
      .filter(Boolean)
      .filter((l) => !l.startsWith('??'));
    if (trackedChanges.length > 0) {
      console.error(JSON.stringify({
        ok: false,
        error: 'Worktree has uncommitted tracked changes — the apply skill should have committed in Step 8.',
        uncommittedFiles: trackedChanges.map(l => l.trim()),
      }));
      process.exit(1);
    }
  }

  // Single-pass merge — no auto-resolution with -X theirs.
  // If conflicts arise, fail and let the user resolve manually.
  // Auto-resolving with -X theirs is dangerous: the worktree branch silently
  // wins all conflicts, including on security-critical files.
  let mergeOk = false;
  let autoResolved = false;
  let pass1ConflictFiles = [];
  try {
    execFileSync('git', ['merge', branch, '--no-edit'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    mergeOk = true;
  } catch (_) {
    // Merge failed — collect conflict files for diagnostics
    try {
      const diffOut = execFileSync(
        'git', ['diff', '--name-only', '--diff-filter=U'],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      pass1ConflictFiles = diffOut ? diffOut.split('\n').filter(Boolean) : [];
    } catch (_cf) {
      // diff failed — leave empty
    }

    // Abort the failed merge cleanly
    try {
      execFileSync('git', ['merge', '--abort'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (_2) {
      // --abort can fail when merge wasn't started (e.g. fast-forward failure) — ignore
    }

    {

      try {
        const runJsonPath = path.join('.pipeline', 'runs', slug, 'run.json');
        if (fs.existsSync(runJsonPath)) {
          const runData = JSON.parse(fs.readFileSync(runJsonPath, 'utf8'));
          runData.mergeBlocked = {
            reason: 'Merge failed after two passes — manual resolution required.',
            conflictFiles: pass1ConflictFiles,
            detectedAt: new Date().toISOString(),
          };
          runData.updatedAt = new Date().toISOString();
          fs.writeFileSync(runJsonPath, JSON.stringify(runData, null, 2) + '\n', 'utf8');
        }
      } catch (_6) {}

      console.error(JSON.stringify({
        ok: false,
        error: 'Merge failed after two passes — manual resolution required.',
        branch,
        into: currentBranch,
        worktreePath: wtPath,
        conflictFiles: pass1ConflictFiles,
        hint: `Resolve manually: git merge ${branch}`,
      }));
      process.exit(1);
    }
  }

  // Merge succeeded — safe to clean up
  run('git', ['worktree', 'remove', wtPath, '--force'], { allowFail: true });
  run('git', ['branch', '-d', branch], { allowFail: true });

  console.log(JSON.stringify({
    ok: true,
    merged: branch,
    into: currentBranch,
    worktreeRemoved: true,
    ...(autoResolved ? { autoResolved: true, strategy: 'theirs' } : {}),
  }));
}

function deleteWorktree() {
  if (!slug) { console.error('Usage: forge-worktree.js delete <slug>'); process.exit(1); }
  validateSlug(slug);

  ensureGitRepo();

  const wtPath = path.join(WORKTREE_DIR, slug);
  const branch = `forge/${slug}`;

  if (!fs.existsSync(wtPath)) {
    console.error(JSON.stringify({ ok: false, error: 'Worktree not found: ' + wtPath }));
    process.exit(1);
  }

  run('git', ['worktree', 'remove', wtPath, '--force'], { allowFail: true });
  run('git', ['branch', '-D', branch], { allowFail: true });
  run('git', ['worktree', 'prune'], { allowFail: true });

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
    // Skip entries with invalid names — filesystem-derived names could contain
    // leading '--' which git would interpret as flags in execFileSync args
    if (!/^[a-zA-Z0-9_-]+$/.test(d.name)) {
      console.error(`[forge-worktree] Skipping invalid worktree entry: "${d.name}"`);
      continue;
    }
    const wtPath = path.join(wtDir, d.name);
    const branch = `forge/${d.name}`;
    run('git', ['worktree', 'remove', wtPath, '--force'], { allowFail: true });
    run('git', ['branch', '-D', branch], { allowFail: true });
    removed++;
  }

  // Clean up the directory itself if empty
  try {
    if (fs.readdirSync(wtDir).length === 0) fs.rmdirSync(wtDir);
  } catch {}

  // Prune stale worktree references
  run('git', ['worktree', 'prune'], { allowFail: true });

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
