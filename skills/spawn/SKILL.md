---
name: forge:spawn
description: "Spawn a new worker session for a feature. Creates a FORGE run, git worktree, and opens a Claude Code session in a new terminal tab."
argument-hint: "<feature description>"
allowed-tools: "Read Glob Grep Bash"
---

Spawn a worker session for the feature described below. Follow these steps exactly.

## Step 1 — Create run

Call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"`)
- `pipelineType`: `"plan"`
- `mode`: `"LEAN"`
- `feature`: a short summary derived from the user's input below

Save the returned `runId`.

## Step 2 — Create worktree

Call `forge_create_worktree` with the `runId` from Step 1.

Save the returned `worktreePath` and `branchName`.

## Step 3 — Spawn worker pane

Run via Bash:
```
node "$CLAUDE_PLUGIN_ROOT/bin/forge-spawn-worker.js" "<worktreePath>" "<runId>" "<feature>" "plan"
```

The feature argument MUST be quoted and sanitized — strip `"`, `\`, backticks, `$`, newlines.

## Step 4 — Confirm to user

Report:
- Worker session opened in a new tab
- Run ID: `<runId>`
- Branch: `<branchName>`
- The worker will start the pipeline when you type "go" in the new tab
