---
name: discard
description: "Discard the pending FORGE gate. Use when: user wants to cancel the current pipeline, reject the plan, or start over."
allowed-tools: "Read Write Edit"
---

Discard the pending FORGE gate.

## Step 1 — Find the pending run

Call `forge_list_runs` with `status: "gate-pending"`. If no runs are found, print "No pending gate to discard." and stop.

If exactly one run is found, save its `runId`. Call `forge_get_run` with that `runId` to get the full run object including `worktreePath` and `gateState`.

## Step 2 — Resolve the gate file location

- If the run has a `worktreePath` (non-null): the gate file is at `<worktreePath>/.pipeline/gate-pending.json`
- If the run has no `worktreePath` (null): the gate file is at `.pipeline/gate-pending.json` (main project root)

## Step 3 — Discard

1. Delete the gate file at the resolved location.
2. If gate1: also remove the active plan section from `docs/PLAN.md` (in the main project root — plans are not worktree-scoped).
3. Update the run: call `forge_update_run` with the `runId` and `status: "discarded"`, `currentStep: "discarded"`.
4. Print "Gate discarded."
