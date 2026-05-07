---
name: forge:approve
description: "Approve the pending FORGE gate. Use when: user wants to approve Gate #1, Gate #2, or a commit gate to proceed with the pipeline."
allowed-tools: "Read Write Bash"
---

Approve the pending FORGE gate.

**CRITICAL — commit gates:** When the gate is `"commit"`, this skill MUST execute Step 4 (commit+merge) in the same turn. The worker has already exited — there is nobody else to commit. Do NOT approve and stop. Do NOT say "the worker will handle it." The conductor IS the committer.

**CRITICAL — always use this skill:** Never manually approve gates with bare `forge_set_gate` calls. Always invoke `/forge:approve` so Step 4 executes for commit gates.

## Step 1 — Find the target run

**Disambiguate the target run — parallel runs may have concurrent pending gates:**

1. Call `forge_list_runs` with `status: "gate-pending"`.
   - If no runs are found, print "No pending gate to approve." and stop.
   - If exactly one run is found, save its `runId`.
   - If multiple runs are found, use the most recently updated one (sort by `updatedAt` desc).
2. Call `forge_check_gate({ runId })` with the resolved `runId` to read that run's specific gate file.
   - If the result is null (no gate file for this run), fall back to `forge_check_gate({})` (legacy singleton) and verify the returned `runId` matches.
3. Extract `gate`, `feature`, and `status` from the gate data.

Call `forge_get_run` with the `runId` to get the full run object including `worktreePath` and `gateState`.

## Step 2 — Resolve the gate file location

- If the run has a `worktreePath` (non-null): the gate file is at `<worktreePath>/.pipeline/gate-pending.json`
- If the run has no `worktreePath` (null): the gate file is at `.pipeline/gate-pending.json` (main project root)

Read the gate file from the resolved location. If it does not exist or `status` is not `"pending"`, fall back to the run's `gateState` field for the gate info.

## Step 2b — Parse inline criteria (gate2 only)

**Only run this step when `gate` is `"gate2"`.** Skip for gate1 and commit gates.

Parse the user's approval message for per-criterion overrides before setting the gate:

1. **Read criteria:** Call `forge_read_criteria({ runId })`. If the result has an empty or missing criteria array, skip the rest of this step.

2. **Scan user message** for `defer AC-<N>` and `reject AC-<N>` tokens (case-insensitive, multiple allowed). Examples:
   - `"approve, defer AC-2"` → defer criterion AC-2
   - `"approve, defer AC-2 and reject AC-4"` → defer AC-2, reject AC-4
   - `"approve"` (no tokens) → accept all criteria

3. **Resolve criterion states:**
   - Criteria matched by `defer AC-<N>`: set `status: "deferred"`
   - Criteria matched by `reject AC-<N>`: set `status: "rejected"`
   - All remaining criteria (not deferred or rejected): set `status: "accepted"`

4. **Gate block check:** If any criterion is `"rejected"`:
   - Print: `Gate blocked — rejected criteria: <comma-joined AC-IDs>`
   - Do NOT call `forge_set_gate`. Stop here.

5. **Write criteria:** Call `forge_write_criteria({ runId, criteria: <updated array> })`.

6. **Print summary:** `<accepted count> accepted, <deferred count> deferred, <rejected count> rejected`

Then continue to Step 3.

## Step 3 — Approve

1. Call `forge_set_gate` with:
   - `gate`: the gate name from the gate file (e.g. `"gate1"`, `"gate2"`, `"commit"`)
   - `feature`: the feature name from the gate file
   - `status`: `"approved"`
   - `runId`: the `runId` from Step 1

   This single MCP call handles: writing the gate file (worktree-aware), syncing to main-root when in a worktree, and updating the run registry.

2. Call `forge_update_run` with the `runId` and:
   - `gateState`: copy the run's existing gateState but set `status: "approved"` and `approvedAt` to current ISO date
   - Do NOT set `status: "completed"` — the run stays `gate-pending` with an approved gateState until commit+merge succeeds (Step 4.6).
3. If `gate` is `"gate1"`:
   - Read `agents` for `forge_advance_stage` from the run object fetched in Step 1: use `run.stages.implement.agents` when that field is a non-empty array; otherwise fall back to `["coder-scout", "coder", "completeness-checker"]`.
   - Call `forge_advance_stage({ runId, targetStage: "implement", agents: <resolved agents> })`.
   - **This spawns the implement worker immediately as a side effect — a new background process starts now.**
   - Print "Gate 1 approved for '<feature>'. Implement worker spawned — use /forge:approve when Gate #2 is ready." (read `feature` from the gate file)
4. If `gate` is `"gate2"`: print "Gate 2 approved for '<feature>'. The worker resumes automatically and the commit will be bundled when it is ready." (read `feature` from the gate file)
5. If `gate` is `"commit"`: print "Commit approved for '<feature>'. Proceeding with commit+merge." (read `feature` from the gate file). **MANDATORY: proceed to Step 4 immediately — the worker has already exited, nobody else will commit. Do NOT stop here.**

If the run's status was already `"completed"`:
- Print "Gate already approved for '<feature>'. Run /forge:implement (gate1) or wait for the worker to reach the commit gate (gate2)."

## Step 4 — Merge (commit gates only)

This step only runs when `gate` is `"commit"`. Skip for gate1/gate2.

**The worker has already committed in the worktree** (apply skill Step 3c — closes TODO `38bca814`). The conductor at the commit gate handles ONLY the merge: never stages, never commits. If the worktree has uncommitted files at this point, the worker's apply commit failed — log the warning and let the user investigate, but do NOT auto-stage and ship potentially BLOCKED phase work.

1. **Resolve worktree:** Call `forge_get_run` with the `runId` to get `worktreePath`. If no worktree, the apply commit happened in main root; skip directly to step 4.

2. **Verify worktree state** (when `worktreePath` is non-null):
   - Run `git -C <worktreePath> status --porcelain` to check for uncommitted tracked files.
   - If uncommitted files exist: log `[worktree] WARN: <N> uncommitted file(s) — these will NOT be merged. Worker should have committed in apply Step 3c. Files: <list>.` Continue with merge anyway.
   - If clean: proceed silently.

3. **Merge worktree** (only when `worktreePath` is non-null):
   - Extract the `runId` from the last path segment of `worktreePath`.
   - Run via Bash: `node bin/forge-worktree.js merge <runId>`.
   - On success: log `[worktree] Merged forge/<runId> into main and cleaned up worktree.`
   - On failure: log `[worktree] Merge failed — resolve manually with: git merge forge/<runId>` and continue. Do NOT force-merge.

4. **Auto-PR** (only when `gitIntegration.autoPR` is true):
   - Read `gitIntegration` from `.pipeline/project.json`.
   - If `autoPR` is true: push branch with `git push -u origin HEAD`, then `gh pr create --title "feat(forge): <safe-feature>" --body "Applied via FORGE pipeline"`.
   - If push or PR creation fails: log the error and continue.

5. **Update runs:** Only after merge is confirmed:
   - If no worktree (main root): call `forge_update_run` with `status: "completed"` after the worker's apply commit succeeded.
   - If worktree: call `forge_update_run` with `status: "completed"` only after `forge-worktree.js merge` returns `ok: true`.
   - If merge fails: do NOT set `status: "completed"`. The run stays `gate-pending` so the observer keeps tracking it. Log the failure and instruct the user to resolve manually.

   **Also mark source run as terminal** (only when `worktreePath` is non-null):
   - Extract the implement/debug/refactor run `runId` from the last path segment of `worktreePath`.
   - Call `forge_update_run` on that source run `runId` with `status: "completed"`.
   - This clears the observer "Action needed" card.
   - If `worktreePath` is null: skip this step — there is no separate source run to mark.

Every git step is wrapped in its own error handling. Failures log and continue — they never block the pipeline. Forbidden operations: `--force`, `--force-with-lease`, `--amend`, `--no-verify`, `git reset`, `git clean`, `git stash`. Conductor does NOT stage or commit.
