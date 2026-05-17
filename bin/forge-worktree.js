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

// Detect tracked-file deletions in main's working tree after worktree-remove
// and restore them. Defensive belt-and-suspenders for TODO 35ce2751: a failed
// merge cascade once left 52 mcp/node_modules files deleted (still in HEAD,
// missing on disk), blocking the next worker spawn.
function restoreAccidentalDeletions() {
  // Use raw execFileSync (NOT the run() wrapper) so we keep the leading space
  // on the first line of `git status --short`. The wrapper's trim() would
  // strip it, making the first ` D <file>` line look like `D <file>` (which
  // signals INDEX deletion, not working-tree deletion). Single-file scenarios
  // would silently miss the deletion. Verified by regression test
  // scripts/forge-worktree-restore-test.mjs (closes d9683d2a part B).
  let status;
  try {
    status = execFileSync('git', ['status', '--short'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (_) {
    return [];
  }
  if (!status) return [];
  const restored = [];
  for (const line of status.split('\n')) {
    // ` D ` = unstaged working-tree deletion of a tracked file
    if (line.startsWith(' D ')) {
      const filePath = line.slice(3).trim();
      if (!filePath) continue;
      run('git', ['restore', filePath], { allowFail: true });
      restored.push(filePath);
    }
  }
  return restored;
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

  // Copy .pipeline/ into worktree, excluding conductor-owned files that cause
  // merge conflicts when both conductor and worker modify them.
  const pipelineSkip = new Set(['board.json', 'modules.json', 'notes', 'runs', 'action-approved.json']);
  const pipelineSrc = '.pipeline';
  const pipelineDst = path.join(wtPath, '.pipeline');
  if (fs.existsSync(pipelineSrc)) {
    copyDirSync(pipelineSrc, pipelineDst, pipelineSkip);
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

  const claudeWorkerSrc = path.join(path.resolve(__dirname, '..'), 'CLAUDE-WORKER.md');
  if (fs.existsSync(claudeWorkerSrc)) {
    fs.copyFileSync(claudeWorkerSrc, path.join(wtPath, 'CLAUDE.md'));
  } else if (fs.existsSync('CLAUDE.md')) {
    // Fallback: copy conductor CLAUDE.md if CLAUDE-WORKER.md is missing (degraded)
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
  // is responsible for committing. Uses `git diff --quiet HEAD` which compares
  // content only, immune to CRLF/autocrlf line-ending noise that `git status
  // --porcelain` reports as modifications on Windows.
  try {
    execFileSync('git', ['-C', wtPath, 'diff', '--quiet', 'HEAD'], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (diffErr) {
    if (diffErr.status && diffErr.status !== 0) {
      // Non-zero exit = real content changes exist
      const wtStatus = run('git', ['-C', wtPath, 'diff', '--name-only', 'HEAD'], { allowFail: true });
      let uncommittedFiles = wtStatus ? wtStatus.split('\n').filter(Boolean) : [];

      // CLAUDE.md inside the worktree is always overwritten by the create step
      // (forge-worktree.js line 126: CLAUDE-WORKER.md → CLAUDE.md). If its
      // content still matches CLAUDE-WORKER.md it was never touched by the
      // worker — exclude it so the pre-flight does not fire a false positive.
      const pluginRoot = path.resolve(__dirname, '..');
      if (isWhitelistedWorktreeSwap(wtPath, pluginRoot)) {
        uncommittedFiles = uncommittedFiles.filter((f) => f !== 'CLAUDE.md');
      }

      if (uncommittedFiles.length > 0) {
        console.error(JSON.stringify({
          ok: false,
          error: 'Worktree has uncommitted tracked changes — the apply skill should have committed in Step 8.',
          uncommittedFiles,
        }));
        process.exit(1);
      }
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

  const fsResult = removeWorktreeDir(wtPath);

  const restoredFiles = restoreAccidentalDeletions();
  if (restoredFiles.length > 0) {
    console.error('[forge-worktree] Auto-restored ' + restoredFiles.length +
      ' accidentally-deleted file(s) after worktree removal: ' + restoredFiles.join(', '));
  }

  console.log(JSON.stringify({
    ok: true,
    merged: branch,
    into: currentBranch,
    worktreeRemoved: fsResult.removed,
    ...(fsResult.removalSkipped ? { removalSkipped: [fsResult.removalSkipped] } : {}),
    ...(restoredFiles.length > 0 ? { restoredFiles } : {}),
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

  const fsResult = removeWorktreeDir(wtPath);

  const restoredFiles = restoreAccidentalDeletions();
  if (restoredFiles.length > 0) {
    console.error('[forge-worktree] Auto-restored ' + restoredFiles.length +
      ' accidentally-deleted file(s) after worktree removal: ' + restoredFiles.join(', '));
  }

  console.log(JSON.stringify({
    ok: true,
    deleted: slug,
    worktreeRemoved: fsResult.removed,
    branchDeleted: branch,
    ...(fsResult.removalSkipped ? { removalSkipped: [fsResult.removalSkipped] } : {}),
    ...(restoredFiles.length > 0 ? { restoredFiles } : {}),
  }));
}

function cleanup() {
  ensureGitRepo();

  const wtDir = WORKTREE_DIR;
  if (!fs.existsSync(wtDir)) {
    console.log(JSON.stringify({ ok: true, removed: 0 }));
    return;
  }

  const dirs = fs.readdirSync(wtDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.isSymbolicLink() && /^[a-zA-Z0-9_-]+$/.test(d.name));
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
    removeWorktreeDir(wtPath);
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

/**
 * Removes the filesystem directory for a worktree path after git has
 * un-registered it. Handles the Windows case where git worktree remove
 * leaves the directory on disk when a file handle is open.
 *
 * Returns { removed: true } on success, { removed: false } when the path
 * did not exist, or { removed: false, removalSkipped: path, reason: msg }
 * when the directory could not be removed due to a locked file.
 *
 * Never throws — errors are captured and returned as structured results.
 */
function removeWorktreeDir(wtPath) {
  if (!fs.existsSync(wtPath)) {
    return { removed: false };
  }
  try {
    fs.rmSync(wtPath, { recursive: true, force: true });
    // Verify the directory is actually gone (rmSync with force: true swallows errors on Windows)
    if (fs.existsSync(wtPath)) {
      return { removed: false, removalSkipped: wtPath, reason: 'directory still exists after rmSync (possible open file handle)' };
    }
    return { removed: true };
  } catch (e) {
    return { removed: false, removalSkipped: wtPath, reason: e.message };
  }
}

/**
 * Lists all subdirectory names under .worktrees/ that are NOT registered
 * as active git worktrees. Returns an array of absolute paths.
 */
function findOrphanWorktreeDirs() {
  if (!fs.existsSync(WORKTREE_DIR)) return [];

  // Get registered worktree paths from git
  let registeredPaths = new Set();
  try {
    const listOut = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    for (const line of listOut.split('\n')) {
      if (line.startsWith('worktree ')) {
        registeredPaths.add(path.resolve(line.slice(9).trim()));
      }
    }
  } catch (_) {
    // If git fails, we can't determine orphans safely — return empty
    return [];
  }

  const dirs = fs.readdirSync(WORKTREE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.isSymbolicLink() && /^[a-zA-Z0-9_-]+$/.test(d.name));

  return dirs
    .map(d => path.join(WORKTREE_DIR, d.name))
    .filter(p => !registeredPaths.has(path.resolve(p)));
}

function audit() {
  ensureGitRepo();

  const prune = process.argv[3] === '--prune';
  const orphans = findOrphanWorktreeDirs();

  if (prune) {
    let pruned = 0;
    const removalSkipped = [];
    for (const orphanPath of orphans) {
      const result = removeWorktreeDir(orphanPath);
      if (result.removed) {
        pruned++;
      } else if (result.removalSkipped) {
        removalSkipped.push(result.removalSkipped);
      }
    }
    const out = { ok: true, pruned, removalSkipped };
    console.log(JSON.stringify(out));
    return;
  }

  if (orphans.length === 0) {
    console.log(JSON.stringify({ ok: true, orphans: [] }));
  } else {
    console.log(JSON.stringify({ ok: false, orphans }));
  }
}

function copyDirSync(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (skip && skip.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

/**
 * Returns true if worktreePath/CLAUDE.md was injected by the create step
 * (i.e. its bytes match pluginRoot/CLAUDE-WORKER.md). Used by the merge
 * pre-flight to skip false-positive dirty-file rejections.
 * Pure function — no side effects, no git calls.
 */
function isWhitelistedWorktreeSwap(worktreePath, pluginRoot) {
  const workerSrc = path.join(pluginRoot, 'CLAUDE-WORKER.md');
  const injectedDst = path.join(worktreePath, 'CLAUDE.md');
  try {
    const srcBuf = fs.readFileSync(workerSrc);
    const dstBuf = fs.readFileSync(injectedDst);
    return srcBuf.equals(dstBuf);
  } catch (_) {
    return false;
  }
}

// Export pure helpers for regression-test access. Closes d9683d2a part B.
// removeWorktreeDir is also exported for direct unit testing (AC-1 test harness).
// Importable as a module without triggering the CLI dispatch below thanks to
// the require.main === module guard.
module.exports = { restoreAccidentalDeletions, isWhitelistedWorktreeSwap, removeWorktreeDir };

// Dispatch — only when invoked directly via the CLI, not on require().
if (require.main === module) {
  switch (cmd) {
    case 'create': create(); break;
    case 'list': list(); break;
    case 'merge': merge(); break;
    case 'delete': deleteWorktree(); break;
    case 'cleanup': cleanup(); break;
    case 'audit': audit(); break;
    default:
      console.error('Usage: forge-worktree.js <create|list|merge|delete|cleanup|audit> [slug]');
      process.exit(1);
  }
}
