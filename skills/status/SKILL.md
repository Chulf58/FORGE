---
name: forge:status
description: "Show FORGE project status with actionable next-step hints. Use when: user asks 'what's the status', 'where are we', wants a project overview, or asks 'what can I do?'."
allowed-tools: "Read Glob"
---

Show FORGE project status with context-sensitive next-step suggestions.

## Data sources

1. Call `forge_read_project` for project identity (name, stack, mode).
2. Call `forge_dashboard_state` for run, gate, board, and merge-blocked state.

Do **not** read `.pipeline/*` directly — the MCP tools are the source of truth.

If either tool returns an error (e.g. project not initialized), surface the error verbatim with `[forge:status] ` prefix and stop.

## Output format

### Status block

Render the status block from both tool responses:

```
FORGE Status
Project: <name> (<techStacks joined>) | Mode: <pipelineMode>
Board: <boardSummary.todoCount> open TODOs (<boardSummary.blockedTodoCount> blocked), <boardSummary.plannedCount> planned
Active runs: <activeRuns.length> | Gates pending: <gatesAwaiting.length>
```

If `gatesAwaiting` is non-empty, list each gate on its own line:

```
  <runId> · <gateState.gate> · <feature>
```

If any entry in `recentCompleted` has `mergeBlocked` non-null, append:

```
Merge blocked: <count> run(s) need manual merge resolution
```

### Next: section

After the status block, append a `Next:` section with 1–3 concrete suggestions derived from the dashboard state. Check these conditions in priority order and include the first that apply (up to 3 total):

1. **Gates pending** — if `gatesAwaiting.length > 0`:
   ```
   → Review and /forge:approve or /forge:discard the pending gate(s).
   ```

2. **Merge-blocked runs** — if any `recentCompleted` entry has `mergeBlocked` non-null:
   ```
   → Run /forge:dashboard to retry the blocked merge.
   ```

3. **Active runs in progress** — if `activeRuns.length > 0` and `gatesAwaiting.length === 0`:
   ```
   → A pipeline is in progress. Run /forge:dashboard for a live view.
   ```

4. **No active runs, open TODOs exist** — if `activeRuns.length === 0` and `boardSummary.todoCount > 0`:
   ```
   → Pick a task and run /forge:plan to start a new feature.
   ```

5. **No active runs, board is empty** — if `activeRuns.length === 0` and `boardSummary.todoCount === 0` and `boardSummary.plannedCount === 0`:
   ```
   → Run /forge:plan to plan a new feature, or /forge:todo to add tasks.
   ```

If none of the above apply (shouldn't happen, but defensive):
```
→ Run /forge:plan to start something new.
```

### Rendering rules

- Render suggestions with `→` prefix, one per line.
- Keep suggestions concrete: name the exact command to run.
- Do not add explanatory prose beyond what is shown above.
- Do not imply autonomous progress or background activity.
- If the project is not initialized, skip the Next: section entirely — the error message is sufficient.
