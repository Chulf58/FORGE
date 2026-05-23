---
name: forge:unblock
description: "Clear a loop-guard block and resume a stuck worker. Use when: a run is in loop-guard-pending state after the agent dispatch cap was hit, and the user wants to resume it."
allowed-tools: "Read Write Bash"
---

Clear a loop-guard block and resume a paused FORGE worker.

**Usage:** `/forge:unblock <runId>` — the runId is REQUIRED.

## Step 1 — Parse and validate the runId argument

Extract the `<runId>` argument from the skill invocation (the text after `/forge:unblock`).

- If no argument is provided, or the argument is empty: go to **Step 2 — Error: missing runId**.
- If an argument is provided: validate it matches the pattern `r-[a-zA-Z0-9]+`. If invalid format: go to **Step 2 — Error: missing runId**.
- If valid format: proceed to **Step 3 — Validate run state**.

## Step 2 — Error: missing or invalid runId

Enumerate all runs in `loop-guard-pending` state:

1. Read `.pipeline/runs/index.json` to get the run index.
2. For each run with `status === 'loop-guard-pending'`, read its `.pipeline/runs/<runId>/loop-guard-blocked.json` sidecar file.
3. Format each as: `<runId>  <agentType>  blocked at <blockedAt>`
4. Emit the following error and stop (do NOT delete any sidecar):

```
[forge:unblock] Error: runId is required.

Runs currently loop-guard-pending:
<formatted list, one per line, or "(none)" if empty>

Usage: /forge:unblock <runId>
```

## Step 3 — Validate run state

1. Read `.pipeline/runs/<runId>/run.json`.
   - If the file doesn't exist: emit `[forge:unblock] Error: run <runId> not found.` and stop.
   - If `run.status` is NOT `loop-guard-pending`: emit error listing all current loop-guard-pending runs (same format as Step 2) and stop with message: `[forge:unblock] Error: run <runId> is not in loop-guard-pending state (current: <status>).`

## Step 4 — Delete the sidecar

1. Delete `.pipeline/runs/<runId>/loop-guard-blocked.json`:
   - Use `Bash` with `node -e "try { require('fs').unlinkSync('<sidecarPath>'); console.log('deleted'); } catch(e) { if (e.code === 'ENOENT') { console.log('already gone'); } else { throw e; } }"`
   - ENOENT (file already gone) is treated as success — the operation is idempotent.
   - Any other error: emit the error and stop.

2. The worker's poll loop (`waitForLoopGuardClear`) detects sidecar absence and resumes automatically:
   - The worker flips `run.status` back to `running`.
   - The worker logs `[forge-worker] loop-guard cleared — resuming`.
   - No additional MCP call is needed.

## Step 5 — Confirm

Emit:
```
[forge:unblock] Loop-guard cleared for run <runId>. Worker is resuming.
Watch the observer for status change back to 'running'.
```
