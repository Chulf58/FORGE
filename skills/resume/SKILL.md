---
name: forge:resume
description: "Re-enter a paused or in-progress FORGE run by runId. Use when: user wants to resume a specific run after interruption, pick up a gate-pending run, or list resumable runs."
allowed-tools: "Read Write"
---

Re-enter a paused or in-progress FORGE run.

This skill restores steering context only — it does not progress the run autonomously and does not invoke another pipeline skill. The user (or the LLM, on the user's next prompt) drives the next step.

## Step 1 — Parse the argument

The user invocation is `/forge:resume <runId>` or `/forge:resume` (no argument).

- If a `runId` is provided: go to **Step 3 (specific-run path)**.
- If no `runId` is provided: go to **Step 2 (listing path)**.

The `runId` is the short registry ID (e.g. `r-2a3ea99f`). Accept it with or without the `r-` prefix; the backend normalizes.

## Step 2 — No-argument path (list resumable runs)

1. Call `forge_list_runs` with no filters to get the full registry.
2. Filter to runs whose `status` is `running`, `gate-pending`, or `created`.
3. Sort by `updatedAt` descending (most recent first).
4. If the filtered list is empty, print exactly:

   ```
   No resumable runs in this project. Use /forge:plan, /forge:implement, /forge:debug, or /forge:refactor to start a new run.
   ```

   Then stop.
5. Otherwise, print one line per run in this exact shape:

   ```
   <runId>  <pipelineType>  <status>  <feature>  · updated <relative time>
   ```

   - `<runId>` — full ID including `r-` prefix.
   - `<pipelineType>` — `plan` / `implement` / `apply` / `debug` / `refactor`.
   - `<status>` — `running` / `gate-pending` / `created`.
   - `<feature>` — the run's `feature` field, truncated to ~60 chars if needed.
   - `<relative time>` — derived from `updatedAt`: e.g. `2 minutes ago`, `3 hours ago`, `5 days ago`. Compute from the timestamp; do not invent.

6. Print the footer line on its own:

   ```
   Run /forge:resume <runId> to re-enter one of these runs.
   ```

7. Stop. Do NOT call `forge_resume_run` in this path — listing is read-only.

## Step 3 — Specific-run path (resume by runId)

1. Call `forge_resume_run` with `{ runId: "<the provided id>" }`.
2. The backend handles all preconditions (registry lookup, non-terminal status, projectRoot match, bound-worktree-exists) and either returns a structured success object or an `isError` result.

### If the call returns an error

Print the error message verbatim, prefixed with `[forge:resume] `. Do not paraphrase or add advice — the backend's error messages already contain the recovery instruction. Then stop.

Example surfacing:
```
[forge:resume] Run r-deadbeef not found in registry
```

### If the call returns success

The response contains: `runId`, `pipelineType`, `feature`, `status`, `stageLabel`, `gateState`, `worktreePath`, `branchName`, `currentUnit`.

Print the success block in this exact order:

1. **Header line:**
   ```
   ▶ Resumed <runId>
   ```

2. **Identity line:**
   ```
   <pipelineType> · <feature>
   ```

3. **Status line — choose exactly one based on `status`:**
   - `gate-pending` (gateState.gate is `gate1`, `gate2`, or `commit`):
     ```
     Status: paused at <gate1|gate2|commit> (awaiting your approval)
     ```
   - `running`:
     ```
     Status: in progress · previously at <stageLabel>
     ```
     If `stageLabel` is null/empty, omit the trailing `· previously at …` clause entirely.
   - `created`:
     ```
     Status: created · not yet started.
     ```

4. **Worktree line (only if `worktreePath` is non-null):**
   ```
   Worktree: <worktreePath> (branch <branchName>)
   ```
   Omit this line entirely when there is no worktree binding.

5. **Stale-lock line (only if `currentUnit` is a non-null object with an `agent` field):**
   ```
   Note: the previous session ended while <currentUnit.agent> was in flight.
   ```
   Omit this line entirely when `currentUnit` is null or absent. Do not add advice, retry instructions, or automating language — the line is a stale-lock signal only.

6. **Blank line.**

7. **Next-step line — choose exactly one based on `status` (and gate, if pending):**
   - `gate-pending` + `gateState.gate === "gate1"`:
     ```
     Next: review docs/PLAN.md, then run /forge:approve to accept the plan or /forge:discard to drop it.
     ```
   - `gate-pending` + `gateState.gate === "gate2"`:
     ```
     Next: review docs/context/handoff.md, then run /forge:approve to accept the implementation or /forge:discard to drop it.
     ```
   - `gate-pending` + `gateState.gate === "commit"`:
     ```
     Next: review the applied changes, then run /forge:approve to commit and merge or /forge:discard to abandon.
     ```
   - `running`:
     ```
     Next: re-invoke /forge:<pipelineType> in this conversation to continue from "<stageLabel>".
     ```
     If `stageLabel` is null, drop the `from "<…>"` clause but keep the rest of the sentence.
   - `created`:
     ```
     Next: re-invoke /forge:<pipelineType> in this conversation to start this run.
     ```

8. Stop. Do not invoke any other skill, do not call any pipeline tool, and do not paraphrase the next-step line.

## Wording rules

- **Use:** "paused at gate1/gate2/commit", "previously at \<step\>", "in this conversation", "awaiting your approval", "re-invoke", "review …, then run …".
- **Avoid:** "running in background", "working in another session", "resuming work elsewhere", "in the background", "the agent is currently …", "auto-resume", "scheduling".
- Past tense (`previously at`) for the run's prior step — never imply the run is advancing on its own.
- Imperative voice for the Next line — address the user directly.
- Never imply that any pipeline work happens between this skill returning and the user's next prompt.
