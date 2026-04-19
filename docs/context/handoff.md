# Handoff: worktree merge conflict handling

## Summary
Upgrade `merge()` in `bin/forge-worktree.js` with dirty-check, two-pass `-X theirs` retry, conflict file listing, and auto-resolve annotation.

## Files to modify
### `bin/forge-worktree.js`
**Change:** Replace `merge()` with pre-merge hygiene check and two-pass merge strategy.

**Find:**
```js
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

  // Commit any uncommitted changes in the worktree before merging.
  const wtStatus = run('git', ['-C', wtPath, 'status', '--porcelain'], { allowFail: true });
```

**Replace with:**
```js
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
  const mainStatus = run('git', ['status', '--porcelain'], { allowFail: true });
  if (mainStatus) {
    const dirtyFiles = mainStatus
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).trim());
    console.error(JSON.stringify({
      ok: false,
      error: 'Main repo has uncommitted changes — commit or stash them before merging.',
      dirtyFiles,
    }));
    process.exit(1);
  }

  // Commit any uncommitted changes in the worktree before merging.
  const wtStatus = run('git', ['-C', wtPath, 'status', '--porcelain'], { allowFail: true });
```

Now replace the body from the worktree-commit block through the end of the function. Find the rest of the original function:

**Find:**
```js
  if (wtStatus) {
    run('git', ['-C', wtPath, 'add', '-A']);
    try {
      execFileSync('git', ['-C', wtPath, 'commit', '-m', 'feat(forge): apply changes'], {
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
    execFileSync('git', ['merge', branch, '--no-edit'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    mergeOk = true;
  } catch (e) {
    // Merge failed (conflict or other error) — abort the merge to restore clean state
    try {
      execFileSync('git', ['merge', '--abort'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (_) {
      // --abort can fail if merge wasn't in progress (e.g. fast-forward failure) — ignore
    }
  }

  if (!mergeOk) {
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
    } catch (_) {}

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
  run('git', ['worktree', 'remove', wtPath, '--force'], { allowFail: true });
  run('git', ['branch', '-d', branch], { allowFail: true });

  console.log(JSON.stringify({
    ok: true,
    merged: branch,
    into: currentBranch,
    worktreeRemoved: true
  }));
}
```

**Replace with:**
```js
  if (wtStatus) {
    run('git', ['-C', wtPath, 'add', '-A']);
    try {
      execFileSync('git', ['-C', wtPath, 'commit', '-m', 'feat(forge): apply changes'], {
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      // Commit failed (pre-commit hook, etc.) — log but continue to merge attempt
      console.error(`[worktree] Pre-merge commit failed: ${e.message}`);
    }
  }

  // Pass 1: plain merge
  let mergeOk = false;
  let autoResolved = false;
  let pass1ConflictFiles = [];
  try {
    execFileSync('git', ['merge', branch, '--no-edit'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    mergeOk = true;
  } catch (_) {
    // Pass 1 failed — collect conflict files while index still has unmerged entries
    try {
      const diffOut = execFileSync(
        'git', ['diff', '--name-only', '--diff-filter=U'],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      pass1ConflictFiles = diffOut ? diffOut.split('\n').filter(Boolean) : [];
    } catch (_cf) {
      // diff failed — leave empty
    }

    // Abort pass 1 before retrying
    try {
      execFileSync('git', ['merge', '--abort'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (_2) {
      // --abort can fail when merge wasn't started (e.g. fast-forward failure) — ignore
    }

    // Pass 2: retry with worktree-side precedence
    try {
      execFileSync('git', ['merge', branch, '--no-edit', '-X', 'theirs'], {
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      mergeOk = true;
      autoResolved = true;
    } catch (_3) {
      // Pass 2 also failed — abort cleanly, use pass1 conflict list for diagnostics
      try {
        execFileSync('git', ['merge', '--abort'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (_5) {
        // ignore abort errors
      }

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
```

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
