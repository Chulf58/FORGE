# Handoff: Fix forge-worktree.js pre-merge dirty-check

## Summary
Filter `.worktrees/` and `.pipeline/` entries from dirty-file detection so merge is not falsely blocked.

## Files to modify
### `bin/forge-worktree.js`
**Change:** Filter noise prefixes from dirtyFiles before blocking the merge.

**Find:**
```js
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
```

**Replace with:**
```js
  // Pre-merge hygiene: reject if main repo has uncommitted changes
  // (exclude .worktrees/ and .pipeline/ — always present during pipeline runs)
  const mainStatus = run('git', ['status', '--porcelain'], { allowFail: true });
  if (mainStatus) {
    const dirtyFiles = mainStatus
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).trim());
    const filteredDirtyFiles = dirtyFiles.filter(
      (f) => !f.startsWith('.worktrees/') && !f.startsWith('.pipeline/'),
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
```

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
