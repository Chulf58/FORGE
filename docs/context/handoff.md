# Handoff: ctx-pre-tool worktree fix + plugin-e2e-validation closure

## Overview

This session closed the final Diesel Priser e2e blocker and recorded the result on the board. Two material changes landed:

1. **`hooks/ctx-pre-tool.js`** — made allowedPaths matching worktree-aware so `/forge:apply` can write inside `.worktrees/<runId>/…` against role patterns like `src/**`.
2. **`.pipeline/board.json`** — closed `plugin-e2e-validation` with accepted Diesel Priser runtime evidence (plan + both gates + implement + apply all PASS) and recorded the merge-back soft-failure nuance (non-blocking, caused by pre-existing dirty main tree).

## What shipped

### `hooks/ctx-pre-tool.js` (commit `3cb6da8`)
- New helper `readActiveWorktreePath(projectDir)`:
  - Sync read of `.pipeline/run-active.json`; returns `data.worktreePath` when truthy, else `null`.
  - Any IO or parse failure → silent `null` (falls through to main-root behavior).
- New helper `isInside(absFilePath, worktreeAbs)`:
  - Case-insensitive, slash-normalized containment check (Windows-safe).
  - Treats exact equality and `prefix + '/'` as "inside".
- Allowed-paths branch:
  - Determines `relBase` = `worktreePath` when the target file is absolute AND inside `worktreePath`; otherwise `process.cwd()` (unchanged).
  - `path.relative(relBase, rawFilePath)` → `path.normalize` → existing `matchesPattern` untouched.
- Read-only agents, empty-allowedPaths agents, manifest loading, and deny envelope all unchanged.

### `.pipeline/board.json` (commit `44b71a2`)
- `plugin-e2e-validation.done` flipped `false` → `true`; added `doneAt: 1776106192875`.
- Appended `FULL-PIPELINE PASS (2026-04-13, Diesel Priser)` segment to `text`: plan PASS, Gate 1 PASS, implement PASS, Gate 2 PASS, apply PASS after `3cb6da8`; implementer wrote inside worktree; documenter cleanup ran; worktree commit succeeded; run closed with `status=completed, currentStep=done`.
- Final `NOTE:` captures the merge-back soft-failure cause (pre-existing dirty main tree) and classifies it per the apply skill's `"log and continue"` contract — explicitly not an apply-path regression.

### Docs (commit `731deb1`)
- `docs/CHANGELOG.md`: new subsection at the top of the `[2026-04-13]` block for the ctx-pre-tool worktree fix.
- `docs/context/handoff.md`: prior intermediate handoff (now superseded by this file).

## Core contract (preserve in any future change)

- **ctx-pre-tool worktree trigger:** worktree base is used only when (a) `run-active.json.worktreePath` exists and is a non-empty string, AND (b) the target file path is absolute, AND (c) `isInside(target, worktreePath)` is true. All three conditions together.
- **Not a permission broadening.** Out-of-bounds files inside the worktree (e.g. `<wt>/secrets/config.json`) still deny because `secrets/config.json` doesn't match `src/**`/`docs/**`. The fix changes comparison origin, not allowed surface.
- **No `.worktrees/**` entries in `.pipeline/agent-roles.json`** — intentional; role patterns stay project-relative.
- **Board truth:** `plugin-e2e-validation` is now closed. Historical PARTIAL (2026-04-11) and FRESH-SESSION PASS (2026-04-13) segments retained verbatim in `text`; no other board entries modified.

## Verification done

Driver script (`C:\Users\cuj\AppData\Local\Temp\forge-test-hook\test-driver.js`, fixture-only, outside repo):

| Case | Input | Expected | Observed |
|---|---|---|---|
| worktree-src-positive | `<wt>/src/main/main.js` | allow | `decision=allow, exit=0` ✅ (Diesel Priser failure case) |
| main-root-src-positive | `<project>/src/main/main.js` | allow | `decision=allow, exit=0` ✅ (legacy path unchanged) |
| out-of-bounds-deny | `<project>/secrets/config.json` | deny | `decision=deny, exit=0` ✅ |
| out-of-bounds-in-worktree-deny | `<wt>/secrets/config.json` | deny | `decision=deny, exit=0` ✅ |

Plus:
- `node --check hooks/ctx-pre-tool.js` → OK.
- `JSON.parse(board.json)` → valid.
- Post-commit `git status` → clean on `main` for each slice.

## Runtime evidence recorded on the board

From the real Diesel Priser run after `3cb6da8`:
- `/forge:plan` PASS → Gate 1 PASS → `/forge:implement` PASS → Gate 2 PASS → `/forge:apply` PASS.
- Implementer subagent wrote successfully inside `.worktrees/<runId>/src/…`.
- Documenter cleanup ran.
- Worktree commit succeeded.
- Run closed with `status=completed, currentStep=done`.
- Merge-back **soft-failed** because the main tree was already dirty (pre-existing uncommitted changes). This is within the skill contract (`log and continue`), not an apply-path blocker.

## Commits (in order)

1. `3cb6da8` — fix(hooks): make ctx-pre-tool path checks worktree-aware
2. `731deb1` — docs(session): handoff + CHANGELOG for ctx-pre-tool worktree fix
3. `44b71a2` — chore(board): close plugin-e2e-validation after Diesel Priser apply pass

Tree currently clean on `main`.

## Risks / Notes

- Synchronous `fs.readFileSync` in `ctx-pre-tool.js` hot path — negligible (`run-active.json` is local and small) and keeps enforcement deterministic before the deny decision.
- `isInside` lowercases both paths — correct on Windows' case-insensitive FS; acceptably permissive elsewhere since `worktreePath` is FORGE-managed, not user input.
- Merge-back soft-fail is known and contracted; the only follow-up is hygiene on the Diesel Priser checkout (see next slice).

## Next recommended slice

Clean the Diesel Priser main tree's pre-existing uncommitted changes (commit or stash), then re-run `/forge:apply` end-to-end on a fresh feature to confirm merge-back now completes **hard-success** — closing out the only remaining soft edge observed in the e2e lifecycle.
