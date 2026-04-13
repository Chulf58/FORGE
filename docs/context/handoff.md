# Handoff: Worktree-aware ctx-pre-tool path matching

## Overview

Diesel Priser e2e validation confirmed `/forge:plan`, Gate 1, `/forge:implement`, and Gate 2 all pass, but `/forge:apply` failed: the implementer subagent was blocked editing `…\.worktrees\r-36df5ba7\src\main\main.js`. Root cause was in `hooks/ctx-pre-tool.js` — allowedPaths were evaluated after relativizing against `process.cwd()` (the main project root), so a valid worktree path `.worktrees/<runId>/src/main/main.js` never matched an agent role pattern like `src/**`.

Fix lands a tightly-scoped, single-file, worktree-aware relativization step in the existing path-enforcement branch. Role manifest, pattern-match logic, workflow-guard, gate logic, and handoff-location rules are all untouched.

## What shipped

### `hooks/ctx-pre-tool.js`
- New helper `readActiveWorktreePath(projectDir)`:
  - Reads `.pipeline/run-active.json` with `fs.readFileSync` (sync to preserve the hook's single entry-point flow).
  - Returns `data.worktreePath` when present and truthy; otherwise `null`.
  - Any IO or parse failure → `null` (silent fall-through to main-root behavior).
- New helper `isInside(absFilePath, worktreeAbs)`:
  - Case-insensitive, slash-normalized containment check (Windows-safe).
  - Treats exact equality and `prefix + '/'` as "inside".
- Allowed-paths branch updated:
  - Determines `relBase` = `worktreePath` when the target file is absolute AND inside `worktreePath`; otherwise `process.cwd()` (unchanged).
  - `path.relative(relBase, rawFilePath)` produces the comparison path, then `path.normalize`.
  - Pattern matching (`matchesPattern`) is untouched.
- No changes to read-only agents, empty-allowedPaths agents, manifest loading, or the PreToolUse envelope.

## Core contract (preserve in any future change)

- **Scope:** only the relativization base for already-approved allowedPaths matching changes. Deny paths, role manifest lookup, read-only short-circuit, and decision envelope are identical to pre-fix.
- **Trigger:** worktree base is used only when (a) `run-active.json.worktreePath` exists and is a non-empty string, AND (b) the target file path is absolute, AND (c) `isInside(target, worktreePath)` is true.
- **Non-trigger cases fall through to `process.cwd()`** — identical to legacy behavior.
- **Out-of-bounds files inside the worktree still deny.** Relativizing against the worktree gives `secrets/config.json`, which fails `src/**` / `docs/**` patterns. The fix does NOT broaden permissions for anything under `.worktrees/`; it simply places comparison at the right origin.
- **No `.worktrees/**` entries were added to `.pipeline/agent-roles.json`** — intentionally, per task constraints. Role patterns stay project-relative.

## Why this shape (vs. alternatives considered)

| Alternative | Why rejected |
|---|---|
| Add `.worktrees/**` to every implementer-type role | Explicitly forbidden by task brief; broadens permissions beyond source intent; still matches against main-root; fragile for nested worktrees. |
| Change `matchesPattern` to try both bases | Violates "keep pattern matching unchanged"; doubles allowed surface silently. |
| Move logic into `workflow-guard.js` | Out of scope; workflow-guard already handles worktree boundary enforcement (the complementary direction). ctx-pre-tool is the correct layer for per-agent allowedPaths. |
| Use async `fs.promises.readFile` for run-active.json | Mixing sync manifest read with async worktree read in the same hot path adds a race window before the deny decision for negligible perf benefit on a small local JSON file. |

## Verification done

Driver script (`C:\Users\cuj\AppData\Local\Temp\forge-test-hook\test-driver.js`, fixture-only, gitignored by location) spawned `node hooks/ctx-pre-tool.js` against a fixture with `run-active.json.worktreePath` set and `.pipeline/agent-roles.json = { implementer: { allowedPaths: ["src/**","docs/**"] } }`:

| Case | Input | Expected | Observed |
|---|---|---|---|
| worktree-src-positive | `<wt>/src/main/main.js` | allow | `decision=allow, exit=0` ✅ — this is the exact Diesel Priser failure case |
| main-root-src-positive | `<project>/src/main/main.js` | allow | `decision=allow, exit=0` ✅ — legacy path unchanged |
| out-of-bounds-deny | `<project>/secrets/config.json` | deny | `decision=deny, exit=0` ✅ — correct deny reason emitted |
| out-of-bounds-in-worktree-deny | `<wt>/secrets/config.json` | deny | `decision=deny, exit=0` ✅ — worktree relativization does NOT blanket-allow under worktree root |

`node --check hooks/ctx-pre-tool.js` → OK.

Post-commit `git status` → clean on `main`.

## Commit

- `3cb6da8` — fix(hooks): make ctx-pre-tool path checks worktree-aware

## Risks / Notes

- Synchronous `fs.readFileSync` added to the hook hot path. `run-active.json` is local, small, and already read by other hooks — impact negligible, and it keeps the enforcement path deterministic (no async gap before the deny decision).
- `isInside` lowercases both paths — correct on Windows' case-insensitive FS, slightly permissive on case-sensitive filesystems. Acceptable because `worktreePath` is FORGE-managed, not user input.
- If `run-active.json.worktreePath` is stored as a relative path (current wiring writes absolute via apply STEP 2b), `path.resolve` normalizes it against `process.cwd()` — matches how it was written. No regression observed.

## Next recommended slice

- Re-run `/forge:apply` on the Diesel Priser run with the existing gate2-approved state to confirm the blocker is gone, and surface the NEXT failure in isolation (statusline/background bug work remains out of scope per task brief).
