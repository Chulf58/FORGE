---
name: forge:help
description: "Show what FORGE can do and how to use it. Use when: user asks 'help', 'what can FORGE do', 'how do I use this', or wants a quick reference of available commands."
allowed-tools: "Read"
---

Show a compact, practical overview of FORGE capabilities and commands, followed by a small state-aware "right now" section.

## Data source

Call `forge_dashboard_state` to get current run, gate, board, and merge-blocked state. This is the same source used by `/forge:status` and `/forge:dashboard`.

If the tool returns an error (project not initialized), skip the "Right now" section entirely — just show the static sections and suggest `/forge:init`.

Do **not** read `.pipeline/*` directly.

## Output format

Render these sections in order, exactly as structured below. Do not add prose between sections. Do not rephrase the command descriptions.

### Section 1: Header

```
FORGE — AI-Powered Development Pipeline

Plan, implement, review, and apply features through a structured agent pipeline.
```

### Section 2: Core commands

```
Commands:
  /forge:plan       Plan a new feature or task
  /forge:implement  Implement from an approved plan
  /forge:apply      Apply reviewed code to source files
  /forge:debug      Diagnose and fix a bug
  /forge:refactor   Restructure existing code

  /forge:status     Project snapshot with next-step hints
  /forge:dashboard  All runs, gates, and board at a glance
  /forge:todo       View or add TODOs
  /forge:resume     Pick up a paused or interrupted run

  /forge:approve    Approve a pending gate
  /forge:discard    Reject a pending gate
  /forge:config     View or change pipeline settings
  /forge:init       Set up FORGE in a new project
```

### Section 3: Right now

Derive 1–3 concrete suggestions from the `forge_dashboard_state` response. Check these conditions in priority order and include the first that apply (up to 3):

1. **Gates pending** — if `gatesAwaiting.length > 0`:
   ```
   → Gate pending: review and /forge:approve or /forge:discard
   ```

2. **Merge-blocked runs** — if any `recentCompleted` entry has `mergeBlocked` non-null:
   ```
   → Merge blocked: open the dashboard (npm run dashboard) to retry
   ```

3. **Active runs in progress** — if `activeRuns.length > 0` and `gatesAwaiting.length === 0`:
   ```
   → Pipeline in progress — run /forge:dashboard for a live view
   ```

4. **Open TODOs, no active runs** — if `activeRuns.length === 0` and `boardSummary.todoCount > 0`:
   ```
   → <todoCount> open TODO(s) — pick one and /forge:plan
   ```

5. **Empty board, no runs** — if `activeRuns.length === 0` and `boardSummary.todoCount === 0`:
   ```
   → Ready to go — run /forge:plan or /forge:todo to start
   ```

Render this section as:

```
Right now:
  <suggestion lines, one per line, → prefix>
```

### Section 4: Where to look

```
More:
  /forge:status     Current state + what to do next
  /forge:dashboard  Live run view with gate actions
  /forge:overview   Full plugin inventory (agents, hooks, tools)
```

## Rendering rules

- Use the exact section headers and formatting shown above.
- Render suggestions with `→` prefix, indented two spaces.
- Keep the full output under 40 lines — this is a quick reference, not a manual.
- Do not add explanatory prose, tips, or commentary beyond what is specified.
- If the project is not initialized, replace the "Right now" section with:
  ```
  Right now:
    → Run /forge:init to set up FORGE in this project
  ```
