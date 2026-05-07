---
name: forge:ship
description: "Collapse gate2 approval + apply worker spawn + auto-commit into a single action. Use when: user says 'ship it', 'approve and apply', 'go ahead and ship', or wants to approve gate2 and commit in one step."
argument-hint: "[feature name]"
allowed-tools: "Read Write Bash"
model: claude-sonnet-4-6
---

Approve Gate #2, spawn the apply worker, and auto-approve the commit gate — all in one action.

**CRITICAL — token writes:** The user typed "ship it" (or similar), NOT "approve". The `hooks/approval-token.js` hook only triggers on the word "approve" — this skill MUST write the approval token manually for every gate action that requires it.

## Step 1 — Find the gate2-pending run

1. Call `forge_list_runs` with `status: "gate-pending"`. If multiple, pick the most recently updated. If none, print "No pending Gate #2 found." and stop. Then call `forge_check_gate({ runId })` with that `runId`. If MCP unavailable, Read `.pipeline/gate-pending.json` directly.

2. Verify the gate is `"gate2"` and `status` is `"pending"`. If not, print:
   "No pending Gate #2 found. Run /forge:implement (or /forge:debug, /forge:refactor) first."
   Stop.

3. Extract `feature` from the gate data. Call `forge_get_run` with the `runId` to get the full run object including `worktreePath`.

## Step 2b — Parse inline criteria (gate2 only)

Parse the user's message for per-criterion overrides before approving:

1. Call `forge_read_criteria({ runId })`. If result has empty or missing criteria array, skip this step.

2. Scan user message for `defer AC-<N>` and `reject AC-<N>` tokens (case-insensitive). If none found, accept all criteria.

3. Resolve criterion states:
   - Criteria matched by `defer AC-<N>`: set `status: "deferred"`
   - Criteria matched by `reject AC-<N>`: set `status: "rejected"`
   - All remaining: set `status: "accepted"`

4. **Gate block check:** If any criterion is `"rejected"`:
   - Print: `Gate blocked — rejected criteria: <comma-joined AC-IDs>`
   - Stop. Do NOT proceed.

5. Call `forge_write_criteria({ runId, criteria: <updated array> })`.

## Step 3 — Write gate2 approval token

The user typed a ship phrase, not "approve", so the hook did not write a token. Write it manually:

Resolve the project root (the directory containing `.pipeline/`) — this is `process.cwd()` when the skill runs (the main project root, NOT the worktree path).

Write `.pipeline/action-approved.json` in the main project root with this content:

```json
{
  "actions": ["gate-approve"],
  "createdAt": "<current ISO>",
  "expiresAt": "<current ISO + 120s>",
  "source": "ship-skill"
}
```

Use Write tool with the exact path `<projectRoot>/.pipeline/action-approved.json`.

## Step 4 — Approve Gate #2

1. Call `forge_set_gate` with:
   - `gate`: `"gate2"`
   - `feature`: the feature name from the gate file
   - `status`: `"approved"`
   - `runId`: the `runId` from Step 1

2. Call `forge_update_run` with the `runId` and:
   - `status: "completed"`
   - `gateState`: copy existing gateState but set `status: "approved"` and `approvedAt` to current ISO date

3. Print: `Gate #2 approved for '<feature>'. Spawning apply worker...`

## Step 5 — Spawn apply worker

Call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"apply"`
- `feature`: the feature name from Step 1
- `spawnWorker`: `true`
- `useWorktree`: `false`

Save the returned `applyRunId` and `logFile`.

Print:
- Apply run ID: `<applyRunId>`
- Log file: `<logFile>` (tail with `tail -f <logFile>` to follow)
- "Waiting for commit gate (polling every 10s, timeout 10 min)..."

## Step 6 — Poll for commit gate

Poll `forge_get_run(applyRunId)` until the commit gate appears or timeout is reached.

**Poll logic:**
- Check: `run.gateState.gate === "commit" && run.gateState.status === "pending"`
- Interval: 10 seconds between polls
- Timeout: 10 minutes (60 polls)
- On each poll, print a brief status: `[ship] Waiting... (attempt <N>/60)`

**If timeout is reached** (60 polls without commit gate):
- Print: "Timeout waiting for commit gate after 10 minutes. Check log: `<logFile>`. Use /forge:approve when ready."
- Stop. Do NOT auto-commit.

**If the apply run reaches `status: "failed"`** before the commit gate:
- Print: "Apply run failed. Check log: `<logFile>`. Resolve manually with /forge:approve."
- Stop.

## Step 7 — Write commit approval token

The commit gate is pending. Write the approval token for the commit gate before calling `forge_set_gate`.

Write `.pipeline/action-approved.json` in the main project root:

```json
{
  "actions": ["gate-approve", "commit"],
  "createdAt": "<current ISO>",
  "expiresAt": "<current ISO + 120s>",
  "source": "ship-skill"
}
```

## Step 8 — Approve commit gate and execute commit+merge

### 8a. Approve commit gate

1. The apply run's `runId` is already known from Step 7. Call `forge_check_gate({ runId })` to read the commit gate file. Extract `feature` and `worktreePath`.

2. Call `forge_set_gate` with:
   - `gate`: `"commit"`
   - `feature`: the feature name
   - `status`: `"approved"`
   - `runId`: the apply run's `runId`

3. Call `forge_update_run` with the apply `runId` and:
   - `status: "completed"`
   - `gateState`: copy existing gateState but set `status: "approved"` and `approvedAt` to current ISO date

### 8b. Commit in worktree (when `worktreePath` is non-null)

Sanitize the feature name before embedding in shell commands: strip `"`, `\`, backtick, `$`, `\n`, `\r`, control chars (`\x00`–`\x1f`).

- Run `git -C <worktreePath> diff --name-only HEAD` to find changed files.
- Stage each file individually: `git -C <worktreePath> add <file>` (do NOT use `git add -A`).
- Then: `git -C <worktreePath> commit -m "feat(forge): <safe-feature>"`.
- If nothing to commit: log `[worktree] No changes to commit — skipping.` and continue.
- If commit fails: log `[worktree] Commit failed: <error>` and continue.

### 8c. Commit in main root (when `worktreePath` is null)

- Run `git diff --name-only HEAD` to find changed files.
- Stage each file individually: `git add <file>` (do NOT use `git add -A`).
- Then: `git commit -m "feat(forge): <safe-feature>"`.
- If nothing to commit: log `[git] No changes to commit — skipping.` and continue.
- If pre-commit hooks fail: log the error output and continue. Do NOT use `--no-verify`.

### 8d. Merge worktree (only when `worktreePath` is non-null)

- Extract the source `runId` from the last path segment of `worktreePath`.
- Run via Bash: `node bin/forge-worktree.js merge <runId>`.
- On success: log `[worktree] Merged forge/<runId> into main and cleaned up worktree.`
- On failure: log `[worktree] Merge failed — resolve manually with: git merge forge/<runId>` and continue. Do NOT force-merge.

### 8e. Auto-PR (only when `gitIntegration.autoPR` is true)

- Read `gitIntegration` from `.pipeline/project.json` (use `forge_read_project` or Read directly).
- If `autoPR` is true: push branch with `git push -u origin HEAD`, then `gh pr create --title "feat(forge): <safe-feature>" --body "Applied via FORGE pipeline"`.
- If push or PR creation fails: log the error and continue.

### 8f. Update source run (only when `worktreePath` is non-null)

- Extract the implement/debug/refactor `runId` from the last path segment of `worktreePath`.
- Call `forge_update_run` on that source run with `status: "completed"`.
- This clears the observer "Action needed" card.

## Step 9 — Done

Print: "Shipped! Feature '<feature>' committed and merged."

Every git step is wrapped in its own error handling. Failures log and continue — they never block the pipeline.

**Forbidden operations:** `--force`, `--force-with-lease`, `--amend`, `--no-verify`, `git reset`, `git clean`, `git stash`. Do NOT run any of these.

$ARGUMENTS
