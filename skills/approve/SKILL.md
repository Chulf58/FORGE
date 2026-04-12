---
name: approve
description: "Approve the pending FORGE gate. Use when: user wants to approve Gate #1 or Gate #2 to proceed with the pipeline."
allowed-tools: "Read Write"
---

Approve the pending FORGE gate.

## Step 1 — Find the pending run

Call `forge_list_runs` with `status: "gate-pending"`. If no runs are found, print "No pending gate to approve." and stop.

If exactly one run is found, save its `runId`. Call `forge_get_run` with that `runId` to get the full run object including `worktreePath` and `gateState`.

## Step 2 — Resolve the gate file location

- If the run has a `worktreePath` (non-null): the gate file is at `<worktreePath>/.pipeline/gate-pending.json`
- If the run has no `worktreePath` (null): the gate file is at `.pipeline/gate-pending.json` (main project root)

Read the gate file from the resolved location. If it does not exist or `status` is not `"pending"`, fall back to the run's `gateState` field for the gate info.

## Step 3 — Approve

1. Update the gate file at the resolved location: set `"status": "approved"`, add `"approvedAt"` with current ISO date.
2. Update the run: call `forge_update_run` with the `runId` and:
   - `status: "completed"`
   - `currentStep`: `"gate1-approved"` or `"gate2-approved"` based on the gate
   - `gateState`: copy the run's existing gateState but set `status: "approved"` and `approvedAt` to current ISO date
3. If `gate` is `"gate1"`: print "Gate 1 approved. Run /forge:implement to start implementation."
4. If `gate` is `"gate2"`: print "Gate 2 approved. Run /forge:apply to apply the changes."

If the run's status was already `"completed"`:
- Print "Gate already approved. Run /forge:implement (gate1) or /forge:apply (gate2) to continue."
