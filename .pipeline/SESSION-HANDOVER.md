# Session Handover — 2026-05-04

## What happened this session

### Merged to main (4 commits + 3 merge commits)

1. **`5a13e14` — Reviewers consume git diff (slice 2)**
   - 7 files changed: 4 reviewer agents (`reviewer-safety.md`, `reviewer-boundary.md`, `reviewer-logic.md`, `reviewer-performance.md`), `scripts/reviewer-dispatch.mjs`, `scripts/reviewer-style-check.mjs`, `skills/implement/SKILL.md`
   - Reviewers now read `docs/context/git-diff.txt` instead of `handoff.md` for code analysis
   - `reviewer-dispatch.mjs` gained `--diff=` and `--coder-status=` CLI args, calls `classifyDiff()` when both provided
   - `reviewer-style-check.mjs` replaced handoff parsing with `parseDiff()` — splits on `diff --git` headers, extracts `+++ b/<path>` and `+`-prefixed lines
   - Implement skill now saves `git diff HEAD > git-diff.txt` before reviewer dispatch
   - Pipeline: plan (r-f8d65e6a) → implement → apply (r-f3d2ef3b)

2. **`6f6836a` — Observer actionNeeded display fix**
   - `mcp/lib/dashboard-state.js`: added `deriveActionNeeded()` function — populates `actionNeeded` field from run's `mergeBlocked` and `gateState`
   - `scripts/forge-observer.mjs`: removed hardcoded "run " prefix from action labels
   - Direct commit on main (small fix, no pipeline)

3. **`3c4ae19` — forge_advance_stage sets run.status to "running"**
   - `mcp/server.js` line 2403: `updateRun(projectDir, runId, { stages: stagesPatch })` → `updateRun(projectDir, runId, { stages: stagesPatch, status: "running" })`
   - Fixes: observer showed stale "gate-pending" hints when implement stage was actively running
   - Pipeline: debug (r-9d828b4a) → apply (r-7875e004)
   - TODO `9b7c5a0d` marked done

4. **`f14f9f2` — Approval token: worktree location mismatch + TTL**
   - `hooks/approval-token.js`: 3 lines changed
     - Import `resolveProjectDir` from `hook-utils.js`
     - TTL: `120_000` (2 min) → `300_000` (5 min)
     - `process.cwd()` → `resolveProjectDir(payload)` — token now always writes to main project root, not worktree
   - Fixes: approval tokens were written to worktree `.pipeline/` but MCP server reads from main root; also 2-min TTL expired during multi-step commit flows
   - Pipeline: debug (r-596b08cc) → apply (r-b3b83c9e)
   - TODOs `015d720f` and `5179b823` marked done

### Important: user must restart session
The approval-token.js hook change requires a session restart to take effect. The new 5-min TTL and resolveProjectDir fix are on disk but the current session still runs the old hook code.

## Current state

- **Main branch is clean** — no uncommitted changes (only untracked pipeline artifacts)
- **No active runs** — all runs completed
- **No pending gates** — all gates resolved
- **All worktrees cleaned up** — merge script removed them

## Open high-priority TODOs

| ID | Bug | Notes |
|---|---|---|
| `d316415f` | Observer card disappears before commit+merge | NEEDS DESIGN DISCUSSION — proposal for lifecycle milestones (gate1ApprovedAt, gate2ApprovedAt, mergedAt) instead of single status. Don't implement without user alignment. |
| `0e05f1ab` | Agent audit trail: locked vs dispatched not compared | `stages.implement.agents` (conductor-locked) vs `run.agents[]` (worker-dispatched) — nothing reconciles. SPECS tab Agent Health should show mismatches. |
| `c930cfc7` | Conductor-locked pipeline not enforced | `forge_advance_stage` sets `stages.implement.agents` but worker ignores it. No `subagent-start.js` enforcement hook exists. Plan exists in PLAN.md (tasks 1-6) but unimplemented. Coupled with `0e05f1ab`. |
| `b75e4462` | forge:init — workflow-guard blocks init's own file creation | Guard prevents writes to `.pipeline/` but init needs to create it. Needs init-mode bypass. |
| `5a89a3b1` | forge:init — bash-guard blocks init operations | Guard rejects node commands reading `.pipeline/` paths during bootstrap. |
| `2e9b1aa8` | forge:init — UX confusion from guard denials | Multiple "blocked" messages during first-run look like failures. |
| `18140f43` | forge.cmd / observer-autosplit.js — no fallback without Windows Terminal | `wt.exe` not on PATH → observer never launches. Fix: `start cmd /k` as fallback to open observer in separate window. Confirmed: wt.exe is NOT available on user's machine — the split-screen observer in this project was never auto-launched. |

## Open medium-priority TODOs (init-related)

| ID | Bug |
|---|---|
| `570fa5d9` | forge:init — settings.json write triggers user denial |
| `580d795a` | forge:init — launcher bakes absolute node path that breaks on move |

## TODO to close

- **`8bdbe81c`** ("Reviewers consume git diff slice 2") — this was completed by r-f8d65e6a. Should be marked done. Was not closed this session because it was created before the pipeline ran.

## Known quirks to watch for

1. **Approval token TTL** is now 5 minutes (was 2). If a commit gate flow still times out, the token is being consumed or the hook isn't firing. The `resolveProjectDir` fix means worktree sessions should no longer lose tokens.

2. **forge_advance_stage now sets status to "running"** — this means the observer should show active stage labels instead of stale gate hints. If you still see stale hints, the MCP server may need a restart (it should auto-reload but verify).

3. **Parallel worktree runs** work but the commit gate flow is fragile when two apply workers compete for the same main-root `gate-pending.json`. The last writer wins. This session ran two debug pipelines in parallel successfully, but commit gates had to be serialized.

4. **CRLF warnings** appear on nearly every git operation in worktrees. These are cosmetic — the actual content is correct. The warnings come from files that were committed with LF but the Windows checkout normalizes to CRLF.

## User context

- The user tested `forge.cmd` in the Dataverse project (C:\Users\cuj\Dataverse) — Windows Terminal is NOT installed, so the launcher falls back to Claude-only without the observer. TODO `18140f43` tracks the fallback fix.
- The user reviewed a full `forge:init` transcript and identified 5 friction points (TODOs b75e4462, 5a89a3b1, 570fa5d9, 580d795a, 2e9b1aa8). The common root cause: hooks don't have an "init mode" bypass.
- The user wants to see the locked-pipeline enforcement (`c930cfc7`) and agent audit comparison (`0e05f1ab`) implemented — these are the next logical bugs after the ones fixed this session.
