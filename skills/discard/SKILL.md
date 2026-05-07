---
name: forge:discard
description: "Discard the pending FORGE gate. Use when: user wants to cancel the current pipeline, reject the plan, or start over."
allowed-tools: "Read Write Edit"
---

Discard the pending FORGE gate.

## Step 1 — Find the target run

**Disambiguate the target run — parallel runs may have concurrent pending gates:**

1. Call `forge_list_runs` with `status: "gate-pending"`.
   - If no runs are found, print "No pending gate to discard." and stop.
   - If exactly one run is found, save its `runId`.
   - If multiple runs are found, use the most recently updated one (sort by `updatedAt` desc).
2. Call `forge_check_gate({ runId })` with the resolved `runId` to read that run's specific gate file.
   - If the result is null (no gate file for this run), fall back to `forge_check_gate({})` (legacy singleton) and verify the returned `runId` matches.
3. Extract `gate`, `feature`, and `status` from the gate data.

Call `forge_get_run` with the `runId` to get the full run object including `worktreePath` and `gateState`.

## Step 2 — Resolve the gate file location

- If the run has a `worktreePath` (non-null): the gate file is at `<worktreePath>/.pipeline/gate-pending.json`
- If the run has no `worktreePath` (null): the gate file is at `.pipeline/gate-pending.json` (main project root)

## Step 2.5 — Kill the worker (if active)

If the run's `pipelineType` is not `"apply"` and the run's `status` is `"running"` or `"gate-pending"`:

Call `forge_kill_worker` with `runId`. This writes the poison-pill sentinel file that the worker polls every 1 s and sends SIGTERM to the process if a PID sidecar exists.

The kill is best-effort — if `forge_kill_worker` returns an error, log the error and continue with the discard. Do not abort the discard on a kill failure.

## Step 3 — Discard

1. Delete the gate file at the resolved location.
2. If gate1: also remove the active plan section from `docs/PLAN.md` (in the main project root — plans are not worktree-scoped).
3. Update the run: call `forge_update_run` with the `runId` and `status: "discarded"`.
4. Print the appropriate message based on gate type:
   - `gate1`: "Gate 1 discarded for '<feature>'."
   - `gate2`: "Gate 2 discarded for '<feature>'."
   - `commit`: "Commit discarded for '<feature>'. Applied changes remain on disk but are not committed." (read `gate` and `feature` from the gate file before deleting it)

> **Worker stop:** The conductor explicitly calls `forge_kill_worker` in Step 2.5 before discarding. This writes `.pipeline/worker-kill/<runId>` (poison pill) and sends SIGTERM to the worker PID. The worker detects the pill within 1 s and exits cleanly.
