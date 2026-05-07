---
name: forge:spawn
description: "Spawn a new worker session for a feature. Creates a FORGE run and launches an Agent SDK worker process."
argument-hint: "<feature description> [--worktree] [--type=plan|implement|debug|refactor|research]"
allowed-tools: "Read Glob Grep"
---

Spawn a worker session for the feature described below. Follow these steps exactly.

## Step 1 — Parse arguments

From the user's input below, extract:
- `feature`: the feature description (everything except flags)
- `useWorktree`: `true` if `--worktree` is present, `false` otherwise
- `pipelineType`: value after `--type=` if present, default `"plan"`

## Step 2 — Create run and spawn worker

Call `forge_create_run` with:
- `sessionId`: `"conductor"`
- `pipelineType`: the type from Step 1
- `feature`: the feature from Step 1
- `spawnWorker`: `true`
- `useWorktree`: the value from Step 1

## Step 3 — Confirm to user

Report:
- Worker session spawned
- Run ID: `<runId>`
- Branch: `<branchName>`
- Pipeline type: `<pipelineType>`
- Worker log: `.pipeline/worker-logs/<runId>.log`
- The worker will begin the pipeline automatically once the process starts

## Feature
$ARGUMENTS
