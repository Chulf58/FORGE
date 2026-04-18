# FORGE — Technical Reference

> Last drift-patched 2026-04-15 from source-of-truth files. Do not edit manually — regenerate with `/forge:refresh-docs` or patch specific drifts per `docs/FORGE-OVERVIEW-RECIPE.md` Part 2.
>
> **Counts at patch time:** 29 agents, 21 skills, 13 hook scripts (7 event types), 24 MCP tools, 5 lib modules, 1 forge-core package.

---

## 1. Pipeline Architecture & Modes

FORGE organises work into **pipeline types** (the skill that starts the run) and **pipeline modes** (the intensity dial). The pipeline type determines which agents are eligible to run. The mode controls which subset actually runs.

### Pipeline types

| Type | Skill | Agent sequence | Gate |
|------|-------|---------------|------|
| Plan feature | `/forge:plan` | brainstormer?, planner, researcher?, gotcha-checker?, reviewer-triage, reviewers | #1 |
| Implement feature | `/forge:implement` | implementation-architect?, coder-scout?, coder, completeness-checker?, reviewer-triage, reviewers | #2 |
| Implement feature (scoped) | `/forge:implement` | implementation-architect, coder-scout?, coder, completeness-checker?, reviewer-triage, reviewers | #2 |
| Apply feature | `/forge:apply` | implementer-triage?, implementer, documenter | none |
| Debug | `/forge:debug` | debug, reviewer-triage, reviewers | #2 |
| Refactor | `/forge:refactor` | refactor, reviewer-triage, reviewers | #2 |

`?` = conditional (skipped based on mode or input signals).

### Pipeline modes

Set per project in `.pipeline/project.json` (`pipelineMode` field):

| Mode | When to use | Effect |
|------|-------------|--------|
| TRIVIAL | Trivial single-file fix | Bypass pipeline entirely |
| SPRINT | Easy task, trust yourself | Core agent only, no reviewers |
| LEAN | Everyday (default) | Core + reviewer-safety + reviewer |
| STANDARD | Multi-file, state or cross-cutting | Core + completeness-checker + reviewer-triage + triage-dispatched reviewers |
| FULL | High-stakes, nothing skipped | Core + completeness-checker + reviewer-triage + all 5 reviewers |

The 5 reviewers: `reviewer-boundary`, `reviewer-safety`, `reviewer-logic`, `reviewer-style`, `reviewer-performance`.

### Mandatory agents (every source change)

| Agent | Role |
|-------|------|
| `reviewer-safety` | Security check |
| `reviewer-boundary` | Boundary correctness |

### Contextual agents (added by orchestrator based on task signals)

| Agent | Include when |
|-------|-------------|
| `implementation-architect` | Plan has 10+ tasks, crosses module boundaries, shared state, migration, or prior failures |
| `researcher` | External API, unfamiliar library, unknown constraint |
| `gotcha-checker` | Pattern with known failure modes |
| `reviewer-logic` | Complex state mutations, async flows, data transforms |
| `reviewer-performance` | Hot paths, data-heavy operations |
| `reviewer-style` | Visible output/formatting change |

---

## 2. The Gate System

Gates are human approval checkpoints. They pause the pipeline and wait for explicit user action.

### Gate #1 — Plan approval

- **When:** After planner + reviewers finish in `/forge:plan`
- **What the user sees:** Plan summary, task count, mode, approach summary
- **State file:** `.pipeline/gate-pending.json` with `"gate": "gate1"`
- **Actions:** `/forge:approve` → proceeds to implement. `/forge:discard` → plan removed from PLAN.md, run marked discarded.

### Gate #2 — Implementation approval

- **When:** After coder + reviewers finish in `/forge:implement`
- **What the user sees:** Implementation summary (handoff overview, reviewer verdicts)
- **State file:** `.pipeline/gate-pending.json` with `"gate": "gate2"`
- **Actions:** `/forge:approve` → proceeds to apply. `/forge:discard` → handoff discarded, run marked discarded.

### Gate state via MCP

| Tool | Purpose |
|------|---------|
| `forge_check_gate` | Read current gate state |
| `forge_set_gate` | Create/update gate (syncs run registry); accepts optional `runId` parameter |

### Gate file schema (`.pipeline/gate-pending.json`)

```json
{
  "runId": "r-abc12345",          // current-gate pointer (NEW)
  "gate": "gate1" | "gate2",
  "feature": "<canonical run.feature>",
  "status": "pending" | "approved",
  "createdAt": "<ISO8601>",
  "approvedAt": "<ISO8601>"        // present when status=approved
}
```

The `runId` field is the deterministic current-gate pointer. Every writer (forge_set_gate, gate-sync repair, pipeline skill Writes) populates it. Readers (approve/discard, gate-sync) prefer `runId` for O(1) targeting and fall back to feature-match for legacy gate files without it.

### Gate enforcement via hooks

`gate-sync.js` (PostToolUse) fires on every Write/Edit to `.pipeline/gate-pending.json`. It:
1. Prefers `runId` from gate file for deterministic targeting; falls back to feature-match for legacy files
2. Finds or auto-creates a matching run in the registry
3. Syncs the gate transition (pending → gate-pending, approved → completed, deleted → discarded)
4. Repairs the gate file: stamps missing `runId`, corrects feature drift to canonical `run.feature`
3. At gate2 pending: auto-creates a worktree if the implement run lacks one

This means gates stay truthful even when the model writes the gate file directly instead of using MCP tools.

---

## 3. Wave Execution

Waves allow parallel task execution within an apply phase. Tasks annotated with `(wave: N)` in the plan are grouped and executed in order.

### How it works

1. Implementer scans all task items for `(wave: N)` annotations
2. If no annotations: sequential execution by task number
3. If annotations present: all wave 1 tasks complete before wave 2, etc.
4. After each wave: self-check verifies every change landed in the target file
5. On pass: emits `[wave-complete] N`
6. On fail: emits `[blocked] Wave N task X` and stops immediately

### Wave assignment rules (planner)

- Only assign waves when 2+ tasks are genuinely independent (no shared files, no dependency)
- Max 5 tasks per wave
- Two tasks that write to the same file are NEVER in the same wave

---

## 4. Every Agent — Roles and Models

### Agent inventory (29 agents)

#### Plan phase

| Agent | Model | maxTurns | Effort | Description |
|-------|-------|----------|--------|-------------|
| brainstormer | claude-sonnet-4-6 | 25 | high | Explores requirements before planning. Asks clarifying questions for vague requests. |
| planner | claude-sonnet-4-6 | 25 | high | Breaks a feature into numbered tasks in docs/PLAN.md. |
| researcher | claude-haiku-4-5 | 25 | high | Investigates technical unknowns, writes to docs/RESEARCH/. Has WebSearch + WebFetch. |
| researcher-triage | claude-haiku-4-5 | 5 | low | Splits research questions into focused briefs for parallel researchers. |
| gotcha-checker | claude-haiku-4-5 | 10 | medium | Validates plans against known pitfalls and project conventions. |

#### Implement phase

| Agent | Model | maxTurns | Effort | Description |
|-------|-------|----------|--------|-------------|
| implementation-architect | claude-sonnet-4-6 | 15 | high | Narrows broad plans to the next smallest safe implementation slice. Writes slice-brief.md. |
| coder-scout | claude-haiku-4-5 | 5 | low | Identifies source files the coder needs. Writes scout.json. |
| coder | claude-sonnet-4-6 | 25 | high | Writes implementation draft to docs/context/handoff.md from approved plan. |
| completeness-checker | claude-haiku-4-5 | 5 | low | Verifies handoff covers all plan tasks. |

#### Review phase

| Agent | Model | maxTurns | Effort | Description |
|-------|-------|----------|--------|-------------|
| reviewer-triage | claude-haiku-4-5 | 5 | low | Dispatches reviewers with file/line excerpts. |
| reviewer | claude-haiku-4-5 | 10 | medium | Boundary and correctness check. |
| reviewer-safety | claude-haiku-4-5 | 10 | medium | Security: injection, secrets, input validation, OWASP. |
| reviewer-logic | claude-haiku-4-5 | 10 | medium | Logic: state mutations, async flows, conditionals. |
| reviewer-performance | claude-haiku-4-5 | 10 | medium | Performance: blocking I/O, memory leaks, hot paths. |
| reviewer-style | claude-haiku-4-5 | 10 | medium | Style: naming, formatting, consistency. |

#### Apply phase

| Agent | Model | maxTurns | Effort | Description |
|-------|-------|----------|--------|-------------|
| implementer-triage | claude-haiku-4-5 | 5 | low | Splits handoff into per-task briefs for parallel implementers. |
| implementer | claude-sonnet-4-6 | 25 | high | Applies approved handoff to source files. Has Write, Edit, Bash. |
| documenter | claude-haiku-4-5 | 10 | medium | Updates CHANGELOG, ARCHITECTURE, modules.json, captures solutions. |

#### Debug / Refactor

| Agent | Model | maxTurns | Effort | Description |
|-------|-------|----------|--------|-------------|
| debug | claude-sonnet-4-6 | 25 | high | Diagnoses bugs, traces root cause, writes fix plan to handoff.md. Has Bash. |
| refactor | claude-sonnet-4-6 | 25 | high | Restructures code for clarity or performance. Writes plan to handoff.md. |

#### On-demand / Utility

| Agent | Model | maxTurns | Effort | Description |
|-------|-------|----------|--------|-------------|
| architect | claude-sonnet-4-6 | 25 | high | Maps modules, writes ARCHITECTURE.md and modules.json. Multiple modes: FULL, HEALTH, GAPS, CROSS-MODULE, REFACTOR. |
| ideator | claude-sonnet-4-6 | 25 | high | Adversarial codebase analysis. Five lenses. Max 10 findings. |
| agent-optimizer | claude-haiku-4-5 | 5 | low | Writes prompt-fix proposals from audit findings. |
| cleanup | claude-haiku-4-5 | 10 | medium | Deletes shipped RESEARCH files, archives overgrown PLANs. |
| compound-refresh | claude-haiku-4-5 | 10 | medium | Knowledge store maintenance: stale docs, duplicates, archiving. |
| integrity-checker | claude-haiku-4-5 | 10 | medium | Pipeline health audits: missing files, broken structure. |
| regression-risk | claude-haiku-4-5 | 5 | low | Flags modules at risk from a handoff change. |
| skills-generator | claude-haiku-4-5 | 10 | medium | Generates per-capability gotcha skill files for a tech stack. |
| tool-call-auditor | claude-haiku-4-5 | 10 | medium | Audits tool usage patterns, flags anti-patterns. |

### Model tiers

| Tier | Model | Agents | Purpose |
|------|-------|--------|---------|
| Heavy | claude-sonnet-4-6 | 10 agents | Core reasoning: planning, coding, debugging, reviewing architecture |
| Light | claude-haiku-4-5 | 19 agents | Triage, validation, documentation, maintenance |

---

## 5. The Signal Protocol

Agents emit signals as bracket-prefixed lines. The orchestrator and hooks consume them.

| Signal | Format | Purpose |
|--------|--------|---------|
| `[suggest]` | `[suggest] chip text` | Suggest next action to orchestrator |
| `[todo]` | `[todo] task text` | Add TODO to board |
| `[health]` | `[health] file\|aspect\|sev\|note` | Report code health issue |
| `[questions]` / `[/questions]` | multi-line block | Brainstormer clarification questions |
| `[reviewer-verdict]` | `[reviewer-verdict] {...JSON}` | Reviewer result |
| `[wave-complete]` | `[wave-complete] N` | Wave N passed self-check |
| `[blocked]` | `[blocked] reason` | Implementation blocked |
| `[task-block]` | `[task-block] taskId blockedBy:id1,id2` | Mark task as blocked |
| `[module]` | `[module] module-id` | Assign feature to module |
| `[approach]` / `[/approach]` | multi-line block | Planner approach summary |
| `[summary]` | `[summary] text` | One-line summary (max 120 chars) |
| `[tier]` | `[tier] a\|b\|c` | Plan complexity tier |
| `[tester-gate]` | `[tester-gate]` | Implementer done, route to documenter |
| `[CONTEXT-CHECKPOINT]` | literal | Context window low — checkpoint needed |

### Reviewer verdict JSON

```json
{
  "agent": "reviewer-safety",
  "verdict": "APPROVED",       // APPROVED | BLOCK | REVISE
  "blockers": [],              // blocking issues (must fix)
  "warnings": [],              // non-blocking issues
  "feature": "feature name",
  "model": "claude-haiku-4-5-20251001"
}
```

### Health aspects

`complexity`, `duplication`, `coupling`, `coverage`, `documentation`, `performance`, `security`, `integrity`, `nyquist`

---

## 6. How a Pipeline Run Executes

Skills are Markdown orchestrator prompts, not external process runners. When a user types `/forge:plan`, Claude Code loads `skills/plan/SKILL.md` and the model follows its step-by-step instructions, spawning agents as subagents.

### /forge:plan walkthrough

1. Create run via `forge_create_run` (pipelineType: "plan")
2. Brainstormer decision: skip if input is detailed, invoke if vague
3. Decide pipeline mode (LEAN/STANDARD/FULL) based on scope
4. Spawn **planner** → writes `docs/PLAN.md`
5. Spawn **researcher** (conditional) → writes `docs/RESEARCH/*.md`
6. Spawn **gotcha-checker** (STANDARD/FULL) → emits verdict
7. Spawn **reviewer-triage → reviewers** → emit verdicts
8. Write `gate-pending.json` with gate1 → present plan to user → wait for approval

### /forge:implement walkthrough

1. Create run via `forge_create_run` (pipelineType: "implement")
2. Create worktree via `forge_create_worktree` → `.worktrees/<runId>/`
3. Mark running, read plan from worktree
4. **Scoping check (Step 2b):** Count active tasks, directories, risky keywords. If any threshold hit → spawn **implementation-architect** → writes `slice-brief.md`
5. Spawn **coder-scout** (skip in LEAN) → writes `scout.json`
6. Spawn **coder** → reads slice-brief.md if present, writes `handoff.md`
7. Spawn **completeness-checker** (skip in LEAN)
8. Spawn **reviewer-triage → reviewers**
9. Write `gate-pending.json` with gate2 → present implementation to user → wait for approval

### /forge:apply walkthrough

1. Create run (pipelineType: "apply") — `forge_create_run` auto-resolves worktree binding from gate2 feature match, writes `worktreePath` to `run-active.json`
2. Verify Gate #2 approved (STEP 1b) — prompt-level check + structural enforcement via `workflow-guard.js`
3. Resolve worktree (STEP 2b) — if worktree exists, persist path + prepend targeting instructions to agent prompts
4. Git branch creation (opt-in, if `gitIntegration.enabled`)
5. Spawn **implementer-triage** (STANDARD/FULL with waves)
6. Spawn **implementer** → edits source files (in worktree if resolved, else main project)
7. Run tests (if `testCommand` configured)
8. Auto-commit on main branch (opt-in, if `gitIntegration.autoCommit`)
9. Spawn **documenter** → updates CHANGELOG, ARCHITECTURE, modules.json, captures solution
10. Auto-PR (opt-in, if `gitIntegration.autoPR`)
11. Worktree commit — mandatory when worktree exists, commits real changes on worktree branch via `git -C`
12. Worktree merge-back — runs `node bin/forge-worktree.js merge <runId>` (commit + merge + cleanup)

### Data flow: which files each agent reads and writes

```
planner        reads: GENERAL.md, PLAN.md, source files (max 5)
               writes: docs/PLAN.md

coder          reads: GENERAL.md, PLAN.md, scout.json, slice-brief.md?, source files
               writes: docs/context/handoff.md, docs/context/coder-status.json

implementer    reads: docs/context/handoff.md, source files
               writes: source files (the actual code changes)

documenter     reads: handoff.md, CHANGELOG.md, ARCHITECTURE.md, modules.json, board.json
               writes: CHANGELOG.md, ARCHITECTURE.md, modules.json, board.json, solutions/
```

### Worktree-backed execution

When `/forge:implement` creates a worktree:
- All agent work happens inside `.worktrees/<runId>/`
- The worktree is on branch `forge/<runId>`
- `.pipeline/` and `docs/` are copied into the worktree

If the model skips worktree creation:
- `gate-sync.js` auto-creates the worktree at gate2 pending time
- `apply-context-inject.js` injects the worktree path when implementer/documenter start

**Worktree lifecycle during apply:**

1. **Binding:** When `forge_create_run` creates an apply run, it reads `gate-pending.json` for the approved gate2 feature, finds the matching implement run by feature match, and writes its `worktreePath` into `run-active.json`. This is structural — zero prompt dependency.
2. **Path isolation:** `workflow-guard.js` reads `worktreePath` from `run-active.json`. Source file writes outside the worktree are blocked with exit 2.
3. **Targeting:** The apply skill prepends worktree path instructions when spawning implementer/documenter. `apply-context-inject.js` provides defense-in-depth via `additionalContext`.
4. **Commit:** `bin/forge-worktree.js merge` auto-commits real changes in the worktree (via `git -C <wtPath> status --porcelain` → `git add -A` → `git commit`) before merging. No `--allow-empty`.
5. **Merge:** `git merge forge/<runId> --no-edit` brings worktree branch changes into main. On conflict: `git merge --abort`, worktree preserved, exit 1 with actionable error.
6. **Cleanup:** On successful merge only: `git worktree remove --force`, `git branch -d`.

### Implementation-architect scoping (Step 2b)

The implement skill checks three conditions before spawning the coder:

1. **Large plan** — more than 8 active `[ ]` tasks
2. **Broad file spread** — 3+ unique top-level directories in task file paths
3. **Risky keywords** — task text contains: "migrate", "refactor", "rename across", "shared state", "store", "schema", "cross-module", "move from"

If ANY is true → `implementation-architect` runs first, writes `slice-brief.md` → coder scopes to it.
If NONE → coder runs against the full plan (normal behavior).

---

## 7. Hook Technical Protocol

Hooks are Node.js scripts executed by Claude Code on specific events. They receive a JSON payload on stdin and communicate via stdout/stderr/exit code.

### Input protocol

All hooks receive JSON on stdin:

```json
{
  "session_id": "abc123",
  "cwd": "/path/to/project",
  "transcript_path": "/path/to/transcript.jsonl",
  "tool_name": "Write",           // PreToolUse/PostToolUse only
  "tool_input": { "file_path": "..." },  // PreToolUse/PostToolUse only
  "agent_id": "xyz",              // SubagentStart/SubagentStop only
  "agent_type": "implementer"     // SubagentStart/SubagentStop only
}
```

### Output protocol

| Channel | Purpose |
|---------|---------|
| **stdout** | JSON with `additionalContext` or `hookSpecificOutput` |
| **stderr** | User-visible messages (logged to terminal) |
| **exit 0** | Success (tool call proceeds) |
| **exit 2** | Block the tool call (PreToolUse only) |

### Blocking example: bash-guard.js

```js
// Checks if a bash command uses a tool that has a dedicated alternative
// e.g., "cat file.txt" → should use Read tool instead
if (isDangerousCommand(command)) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Use the Read tool instead of cat/head/tail.'
    }
  }) + '\n');
  process.exit(2); // BLOCKS the tool call
}
```

### Context injection example: apply-context-inject.js

```js
// Injects worktree path into implementer agent's conversation
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SubagentStart',
    additionalContext: 'FORGE WORKTREE CONTEXT\nWorktree: /path/to/.worktrees/r-abc123\n...'
  }
}) + '\n');
process.exit(0); // Does NOT block — just adds context
```

### Safe stdin reading pattern

Every hook uses readline + timeout:

```js
const STDIN_TIMEOUT_MS = 5000;
let inputData = '';
const timer = setTimeout(() => {
  main(inputData || '{}').catch(() => process.exit(0));
}, STDIN_TIMEOUT_MS);
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => { inputData += line + '\n'; });
rl.on('close', () => {
  clearTimeout(timer);
  main(inputData || '{}').catch(() => process.exit(0));
});
```

---

## 8. Skills (User Commands)

21 skills organised by role.

**Visibility model:** Pipeline skills (plan, implement, apply, debug, refactor, chat) run in the **main conversation** — no `context: fork`. The user sees agent reasoning, tool calls, and reviewer verdicts live as they happen. Maintenance skills (ideate, refresh, refresh-docs) keep `context: fork` because they produce a single end-of-run report — visibility adds no value there.

### Pipeline skills (agent-backed, run in main chat)

| Skill | Description | Agents | Gate |
|-------|-------------|--------|------|
| `/forge:plan` | Plan a feature | brainstormer?, planner, researcher?, gotcha-checker?, reviewers | #1 |
| `/forge:implement` | Implement from plan | implementation-architect?, coder-scout?, coder, completeness-checker?, reviewers | #2 |
| `/forge:apply` | Apply handoff to source | implementer-triage?, implementer, documenter | none |
| `/forge:debug` | Diagnose and fix bug | debug, reviewers | #2 |
| `/forge:refactor` | Restructure code | refactor, reviewers | #2 |

### Orchestration skills (run in main chat)

| Skill | Description |
|-------|-------------|
| `/forge:chat` | Conversational orchestrator — intent detection, multi-session management, natural gate approval |

### Gate skills

| Skill | Description |
|-------|-------------|
| `/forge:approve` | Approve pending gate (finds run, updates gate file, syncs registry) |
| `/forge:discard` | Discard pending gate (deletes gate file, marks run discarded) |

### Status & data skills

| Skill | Description |
|-------|-------------|
| `/forge:status` | Project status (mode, board counts, active feature, gate) |
| `/forge:dashboard` | Styled cards for all active and gate-pending runs from the registry |
| `/forge:resume` | Re-enter a paused or in-progress run by runId; lists resumable runs when called with no argument |
| `/forge:planned` | Show planned items from board |
| `/forge:health` | Show health signals |
| `/forge:todo` | List/add TODOs on the board |
| `/forge:config` | View/update project settings |
| `/forge:overview` | Full inventory of agents, skills, hooks, MCP tools |
| `/forge:help` | Compact quick reference — grouped commands, state-aware "right now" suggestions from `forge_dashboard_state`, "where to look" pointers. Capped at ~40 lines. |

`/forge:resume` restores steering context for a paused or in-progress run — it overwrites `.pipeline/run-active.json` to point at the requested run and prints the next step the user should take. **It does not progress the run autonomously and does not invoke any pipeline skill.** Once steering is restored, the user (or the LLM on the user's next prompt) drives the next action: re-invoke `/forge:<pipelineType>` for `running`/`created` runs, or `/forge:approve` / `/forge:discard` for `gate-pending` runs. Refuses cleanly on unknown runId, terminal status (`completed`/`failed`/`discarded`), wrong project, or missing bound worktree.

### Setup & maintenance skills

| Skill | Description | Visibility |
|-------|-------------|-----------|
| `/forge:init` | Initialize FORGE: clean stale artifacts, .gitignore, detect tracked state, register statusLine wrapper | main chat |
| `/forge:ideate` | Adversarial codebase analysis (ideator agent) | forked |
| `/forge:refresh` | Knowledge store maintenance (compound-refresh agent) | forked |
| `/forge:refresh-docs` | Regenerate FORGE-OVERVIEW.md and FORGE-REFERENCE.md | forked |

`/forge:init` STEP 1e generates `.claude/forge-status.cmd` (a wrapper using `process.execPath` for absolute Node path) and registers it as the project's `statusLine.command`. This avoids the bare-`node`-on-PATH dependency and the cmd.exe double-quoted-token parsing bug on Windows.

**Skill namespace policy:** All FORGE skill `name:` fields in `SKILL.md` frontmatter must carry the `forge:` prefix (e.g. `name: forge:help`). This prevents command-shadowing collisions with Claude Code's native commands. Confirmed fix: `name: config` (bare) silently resolved to FORGE config instead of Claude Code's native `/config` until the blanket prefix was applied (commit `59039ee`).

### Statusline visibility rule (intentional idle gaps)

The statusline shows only runs whose registry status is `running` or `gate-pending`. A `completed` run — including a plan run immediately after `/forge:approve` writes `status: "completed"` and `currentStep: "gate1-approved"` — disappears from the statusline by design.

This produces an idle gap between Gate #1 approval and the next `/forge:implement` invocation. **The gap is intentional and truthful, not a bug.** Gates are explicit human pauses; the user has approved a plan and has not yet started implementation, so the system genuinely has nothing in flight. The "what to do next" prompt lives in the `/forge:approve` response text ("Run /forge:implement to start implementation"), not in persistent statusline state.

The statusline's job is compressed awareness of running work. It must never invent a transition status (e.g., "awaiting implement") to fill the gap — that would lie about reality and force every reader to handle a state that doesn't reflect any in-flight activity.

The same rule applies after Gate #2: the implement run becomes `completed` on approval, and the statusline is idle until `/forge:apply` creates a new run.

### Statusline vs dashboard responsibility split

The statusline and dashboard are two different surfaces with disjoint scopes. They MUST stay disjoint to remain useful.

- **Statusline** is a compressed awareness surface for what is in flight RIGHT NOW. It shows project identity plus a small bounded number of active runs (currently `MAX_VISIBLE_RUNS = 2`) with stage progress and gate-waiting indicators. It is read-only, single-line, and updates live. It must not contain feature names, per-agent activity, cost metrics, mode/worktree metadata, history, or interactive controls — those exceed what one line can compress truthfully.
- **Dashboard** owns full queue/detail/action surfaces: complete list of all active and recent runs, per-run detail (feature name, agents, timing, cost, worktree), routed attention between multiple competing gates, approval/discard controls, history browsing, and cross-run views across the registry. The dashboard does not yet exist; this rule defines its scope when it does.
- **`+N more` is the explicit overflow handoff.** When the statusline cannot compress further without lying, it points to the dashboard rather than overflowing the line. Future contributors must not raise `MAX_VISIBLE_RUNS` to "fix" overflow — fanout beyond a small N belongs in the dashboard, not the statusline.

This boundary is a hard product rule. Statusline content additions that move toward queue/detail/action responsibilities should be rejected as scope creep.

---

## 9. Hook Inventory

13 hook scripts across 7 event types:

### SessionStart (3 hooks)

| Script | Purpose | Blocks? |
|--------|---------|---------|
| `mcp-deps-install.js` | Auto-installs MCP server dependencies when missing | No |
| `ctx-session-start.js` | Computes remaining context %, writes bridge file when <=50% | No |
| `forge-banner.js` | Writes `.pipeline/forge-banner-pending` flag — picked up by next PostToolUse | No |

### PreToolUse (5 hook entries, 3 scripts)

| Script | Matcher | Purpose | Blocks? |
|--------|---------|---------|---------|
| `bash-guard.js` | Bash | Blocks dangerous commands (cat, grep, find, etc.) — redirects to Read/Grep/Glob | **Yes** |
| `workflow-guard.js` | Write, Edit | (1) Blocks source file writes during apply: gate2 must be approved, handoff feature must match gate, write path must be inside resolved worktree. (2) Warns when editing source files outside a pipeline (opt-in advisory). | **Yes** for apply gate/handoff/path / No for advisory |
| `ctx-pre-tool.js` | Write, Edit | Enforces agent role permissions from agent-roles.json | **Yes** |

### PostToolUse (2 hook entries, 2 scripts)

| Script | Matcher | Purpose | Blocks? |
|--------|---------|---------|---------|
| `ctx-post-tool.js` | * | Logs tool calls to audit JSONL, context window warnings at <=35%/<=25%. On first invocation if `.pipeline/forge-banner-pending` exists: injects FORGE banner via `additionalContext` and deletes the flag. | No |
| `gate-sync.js` | Write, Edit | Syncs gate file writes to run registry; prefers `runId` from gate file for targeting; uses canonical `run.feature` for gateState; repairs gate-pending.json (stamps runId, fixes feature drift); auto-creates worktrees at gate2 | No |

### PostCompact (1 hook)

| Script | Purpose | Blocks? |
|--------|---------|---------|
| `ctx-post-compact.js` | Re-injects forge-rules.md into context after compaction | No |

### Stop (1 hook)

| Script | Purpose | Blocks? |
|--------|---------|---------|
| `ctx-stop.js` | Advisory: incomplete agents, pending gates, unapplied handoffs (30min staleness guard) | No |

### SubagentStart (2 hooks)

| Script | Purpose | Blocks? |
|--------|---------|---------|
| `subagent-start.js` | Records agent startup in run-active.json. Filters by FORGE allowlist (derived from `agents/*.md`) — built-in subagents (general-purpose, Explore, claude-code-guide) are skipped. Tolerates `forge:` namespace prefix. | No |
| `apply-context-inject.js` | Injects worktree path for implementer/documenter agents | No |

### SubagentStop (1 hook)

| Script | Purpose | Blocks? |
|--------|---------|---------|
| `subagent-stop.js` | Records completion, extracts reviewer-verdict outcome. Symmetric FORGE allowlist filter (matches subagent-start.js) — non-FORGE agent types are skipped to prevent spurious "no matching entry" warnings. | No |

### Enforcement summary

| Enforcement | Mechanism | Strength |
|-------------|-----------|----------|
| Tool usage (no bash cat/grep) | bash-guard.js blocks | Hard (exit 2) |
| Agent write permissions | ctx-pre-tool.js blocks | Hard (exit 2) |
| **Apply gate sequencing** | **workflow-guard.js blocks source writes during apply unless gate2 approved** | **Hard (exit 2)** |
| **Apply handoff matching** | **workflow-guard.js blocks source writes if handoff feature doesn't match gate feature** | **Hard (exit 2)** |
| **Apply worktree path isolation** | **workflow-guard.js blocks source writes outside resolved worktree during worktree-backed apply** | **Hard (exit 2)** |
| **Merge conflict safety** | **forge-worktree.js merge aborts on conflict, preserves worktree/branch, exits non-zero** | **Hard (exit 1)** |
| **Canonical feature preservation** | **forge_update_run forces gateState.feature = run.feature; gate-sync repairs gate-pending.json drift** | **Structural** |
| **Gate runId targeting** | **gate-pending.json carries `runId` field; approve/discard target by runId; gate-sync prefers it for O(1) lookup** | **Structural** |
| **Active-run contamination filter** | **subagent-start/stop hooks filter by FORGE agent allowlist (derived from agents/*.md)** | **Structural** |
| Worktree binding for apply | forge_create_run auto-resolves worktree from gate2-approved implement run | Structural |
| Commit-before-merge | forge-worktree.js merge auto-commits real worktree changes before merging (no --allow-empty) | Structural |
| Run lifecycle truthfulness | gate-sync.js auto-creates/syncs | Structural recovery |
| Worktree creation at gate2 | gate-sync.js auto-creates worktree | Structural recovery |
| Orphaned run recovery | listRuns → rebuildIndex when index missing/empty | Structural recovery |
| Run marker initialization | forge_create_run writes run-active.json | Structural |
| Gate timestamp preservation | forge_set_gate preserves pending createdAt on approval | Structural |
| Worktree context for apply | apply-context-inject.js injects | Soft (additionalContext) |
| Context preservation | ctx-post-compact.js re-injects rules | Soft (additionalContext) |
| Pipeline awareness | workflow-guard.js warns (opt-in) | Advisory |
| FORGE banner on session start | SessionStart writes flag → first PostToolUse injects via additionalContext, deletes flag | Structural |

---

## 10. MCP Server & Tools

### Server architecture

- **Entry point:** `mcp/server.js` (ESM, 24 tools)
- **Dependencies:** `@modelcontextprotocol/sdk`, `zod` (installed via SessionStart hook)
- **Package:** `mcp/package.json` with `"type": "module"` (separate from root CommonJS)
- **Declaration:** `.mcp.json` with `${CLAUDE_PLUGIN_ROOT}` path expansion
- **Transport:** StdioServerTransport (JSON-RPC over stdin/stdout)

**Critical:** Never `console.log()` in the MCP server — it corrupts JSON-RPC. Use `console.error()` for debug output.

### Project directory resolution

```
Primary: process.cwd()  (set by Claude Code per MCP spec)
Override: CLAUDE_PROJECT_DIR env var
Resolve at call time via resolveProjectDir() — never cache at module level
```

### Tool inventory (24 tools)

#### Board management

| Tool | Read-only | Description |
|------|-----------|-------------|
| `forge_read_board` | Yes | Returns todos, filtered by status/priority/tags/blocked |
| `forge_add_todo` | No | Adds new task (text, priority, tags) |
| `forge_update_task` | No | Updates task (done, text, priority) |
| `forge_set_blocked_by` | No | Sets/clears blockedBy array on a task |

#### Project configuration

| Tool | Read-only | Description |
|------|-----------|-------------|
| `forge_read_project` | Yes | Returns project.json config |
| `forge_update_config` | No | Updates a config field (key/value) |
| `forge_read_modules` | Yes | Returns module registry |
| `forge_assign_module` | No | Assigns task to module |

#### Pipeline state

| Tool | Read-only | Description |
|------|-----------|-------------|
| `forge_get_active_run` | Yes | Current run state from run-active.json |
| `forge_check_gate` | Yes | Pending gate state or null |
| `forge_set_gate` | No | Creates/updates gate, syncs run registry |

#### Run registry

| Tool | Read-only | Description |
|------|-----------|-------------|
| `forge_create_run` | No | Creates new run (sessionId, pipelineType, mode, feature) |
| `forge_get_run` | Yes | Returns single run by ID |
| `forge_list_runs` | Yes | Lists runs, filtered by status/type |
| `forge_update_run` | No | Patches run (status, currentStep, worktreePath, branchName, gateState) |
| `forge_create_worktree` | No | Creates git worktree at .worktrees/<runId>/ |
| `forge_resume_run` | No | Restores `run-active.json` steering pointer to a non-terminal run; refuses on terminal status, wrong project, or missing bound worktree. Does not mutate the run's own status, currentStep, gateState, or agents. |

#### Dashboard

| Tool | Read-only | Description |
|------|-----------|-------------|
| `forge_dashboard_state` | Yes | Zero-input snapshot: `activeRuns[]` (non-terminal, with stageLabel, gateState, worktreePath, currentUnit), `gatesAwaiting[]` (actionable pending gates), `recentCompleted[]` (≤5 terminal tail), `boardSummary` (counts + top-priority open TODOs ≤5). Shared source for the MCP tool, the wrapper/observer TUIs, and the legacy HTTP sidecar. |

#### Model routing

| Tool | Read-only | Description |
|------|-----------|-------------|
| `forge_get_model_recommendation` | Yes | Recommended model for agent (agentName, budgetMode) |
| `forge_call_external` | No | Send prompt to external provider (OpenAI, etc.) |
| `forge_read_usage` | Yes | Provider usage state from usage.json |
| `forge_reset_usage` | No | Reset provider usage counters |
| `forge_update_agent_model` | No | Update preferred/fallback model for agent |
| `forge_list_models` | Yes | Model catalog, optionally filtered |

### Error handling pattern

Every tool handler wraps logic in try/catch. Errors return `{ content: [{ type: "text", text: "..." }], isError: true }`. Never throw from handlers.

### JSON read/write pattern

Read full file → parse → mutate in-place → write full object back. Never reconstruct from known fields — preserves unknown/extra fields.

---

## 11. Model Routing

### Architecture

| Module | Purpose |
|--------|---------|
| `mcp/lib/config-store.js` | Config read/write, plugin data dir resolution |
| `mcp/lib/usage-store.js` | Per-provider usage tracking (requests, tokens, quota) |
| `mcp/lib/router.js` | Pure recommendation function, no I/O |
| `mcp/lib/openai-adapter.js` | OpenAI Responses API adapter |
| `mcp/lib/dashboard-state.js` | Dashboard state builder — shared by `forge_dashboard_state` MCP tool, the wrapper/observer TUIs, and the legacy HTTP sidecar; guarantees identical payloads across all surfaces |

### Two-track routing

| Track | Mechanism | When |
|-------|-----------|------|
| Anthropic models | `model:` field in agent frontmatter, Claude Code handles natively | Default for all agents |
| External providers | `forge_call_external` MCP tool | When non-Anthropic route configured |

### Config file resolution

```
1. $CLAUDE_PLUGIN_DATA/forge-config.json    (persistent, global)
2. .pipeline/forge-config.json              (per-project fallback)
3. forge-config.default.json                (bundled template, bootstrapped on first session)
```

### API key handling

- Keys referenced by environment variable name only (`envVar` field in provider config)
- Never stored as plaintext values in config
- Resolved at call time via `process.env[provider.envVar]`
- Reject both `undefined` and empty string

### Recommendation priority chain

1. Agent's preferred model (if provider enabled + not quota-exhausted)
2. Agent's fallback model (if preferred unavailable)
3. Cheapest available model matching required capabilities (budget-mode sensitive)
4. Default: `claude-sonnet-4-6` via `anthropic`

### Default providers

| Provider | Enabled | Models |
|----------|---------|--------|
| `anthropic` | Yes | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001 |
| `openai` | No | codex-mini-latest |

---

## 12. Project Configuration (project.json)

Located at `.pipeline/project.json` in each project:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Project name |
| `description` | string | Project description |
| `techStacks` | string[] | Active tech stacks |
| `techStackLabels` | string[] | Display labels for stacks |
| `pipelineMode` | enum | TRIVIAL, SPRINT, LEAN, STANDARD, FULL |
| `testCommand` | string | Shell command to run tests after apply (optional) |
| `gitIntegration` | object | Git workflow config (see below) |

### Git integration

```json
{
  "gitIntegration": {
    "enabled": false,
    "branchPrefix": "forge/",
    "autoCommit": false,
    "autoPR": false
  }
}
```

- `enabled` — master switch; all git steps skip when false
- `branchPrefix` — prefix for feature branches (default: `"forge/"`)
- `autoCommit` — commit changes after implementer + tests
- `autoPR` — create PR via `gh pr create` after documenter

**Safety:** Every git step logs with `[git-integration]` prefix and continues on failure. Forbidden operations: `--force`, `--amend`, `--no-verify`, `git reset`, `git clean`, `git stash`.

### Project hygiene (/forge:init)

`/forge:init` runs project hygiene in its always-run STEP 1, even for already-initialized projects:

| Sub-step | What it does |
|----------|-------------|
| 1a | Removes stale `.claude/commands/forge/` (pre-plugin command files) |
| 1b | Removes 5 known FORGE hook files from `.claude/hooks/` (pre-plugin local copies) |
| 1c | Ensures `.pipeline/` and `.worktrees/` are in `.gitignore` (creates file if absent, appends if missing) |
| 1d | Detects already-tracked `.pipeline/` or `.worktrees/` via `git ls-files`, prints WARNING with exact `git rm --cached` remediation commands (does NOT execute them) |

**`.gitignore` entries managed by init:**
```
.pipeline/
.worktrees/
```

---

## 13. Run Registry (forge-core)

The run registry lives in `packages/forge-core/src/runs/` and provides CRUD for pipeline runs.

### Run schema

```typescript
Run {
  runId: string           // e.g. "r-a1b2c3d4"
  sessionId: string
  projectRoot: string
  worktreePath: string | null
  branchName: string | null
  pipelineType: "plan" | "implement" | "apply" | "debug" | "refactor"
  mode: "TRIVIAL" | "SPRINT" | "LEAN" | "STANDARD" | "FULL"
  feature: string
  status: "created" | "running" | "gate-pending" | "completed" | "failed" | "discarded"
  createdAt: string       // ISO datetime
  updatedAt: string       // ISO datetime
  currentStep: string | null
  currentUnit: { agent, startedAt } | null  // set by subagent-start, cleared by subagent-stop
  gateState: { gate, status, feature, createdAt, approvedAt } | null
  mergeBlocked: { reason: string, detectedAt: string } | null  // null when merge succeeded
  agents: RunAgent[]
  artifacts: { plan, handoff, scout } (nullable strings)
}
```

### Storage layout

```
.pipeline/runs/
  index.json              — lightweight pointers (runId, status, updatedAt)
  r-a1b2c3d4/run.json    — full run object
  r-e5f6g7h8/run.json
```

### Core functions

| Function | Purpose |
|----------|---------|
| `createRun({ projectRoot, sessionId, pipelineType, mode, feature })` | Creates run + index entry. Also writes `run-active.json` with top-level marker. |
| `getRun(projectRoot, runId)` | Returns validated Run or null |
| `listRuns(projectRoot, { status?, pipelineType? })` | Returns filtered index entries. Lazy heals: if index missing/empty but `r-*` dirs exist, calls `rebuildIndex`. |
| `updateRun(projectRoot, runId, patch)` | Merges patch, re-validates, syncs index |
| `createWorktree(projectRoot, runId)` | Creates git worktree, copies .pipeline/ + docs/, persists path on run |
| `rebuildIndex(projectRoot)` | Scans `r-*/run.json` files, reconstructs `index.json`. Called lazily by `listRuns` on missing/empty index. |

---

## 14. Key Files Reference

### Plugin infrastructure

| File | Purpose |
|------|---------|
| `.claude-plugin/plugin.json` | Plugin manifest (name: forge, version: 0.2.0) |
| `.mcp.json` | MCP server declaration |
| `forge-config.default.json` | Default model routing config template |
| `forge-rules.md` | Curated rules for PostCompact reinjection |
| `CLAUDE.md` | Project instructions (pipeline types, modes, protocols) |

### Agents (29 files)

`agents/*.md` — each file is a complete agent definition with YAML frontmatter and prompt.

### Skills (21 directories)

`skills/*/SKILL.md` — each directory contains one skill definition.

### Hook scripts (13 files)

`hooks/*.js` — Node.js scripts. `hooks/hooks.json` — event routing declarations.

### MCP server (8 files)

| File | Purpose |
|------|---------|
| `mcp/server.js` | MCP server entry point (24 tools) |
| `mcp/server-minimal.js` | Lightweight fallback |
| `mcp/package.json` | ESM package config |
| `mcp/lib/config-store.js` | Config read/write |
| `mcp/lib/router.js` | Model recommendation |
| `mcp/lib/usage-store.js` | Usage tracking |
| `mcp/lib/openai-adapter.js` | OpenAI adapter |
| `mcp/lib/dashboard-state.js` | Dashboard state builder (shared by MCP tool, wrapper/observer TUIs, and legacy HTTP sidecar) |

### forge-core package (11 files)

| File | Purpose |
|------|---------|
| `packages/forge-core/src/runs/schemas.js` | Zod schemas (Run, RunStatus, GateState, RunAgent) |
| `packages/forge-core/src/runs/storage.js` | JSON file read/write helpers |
| `packages/forge-core/src/runs/createRun.js` | Create run + index entry |
| `packages/forge-core/src/runs/getRun.js` | Read single run |
| `packages/forge-core/src/runs/listRuns.js` | List/filter runs (with lazy index rebuild) |
| `packages/forge-core/src/runs/updateRun.js` | Patch run + sync index |
| `packages/forge-core/src/runs/createWorktree.js` | Git worktree creation. Filesystem `.git` check (no PATH dependency for repo detection). `getGitExecutable()` resolves git via PATH then falls back to Program Files / LOCALAPPDATA install candidates. Uses `execFileSync` (no shell quoting issues on Windows). |
| `packages/forge-core/src/runs/rebuildIndex.js` | Reconstruct index.json from r-*/run.json files |
| `packages/forge-core/src/runs/index.js` | Public API exports |

### Utility scripts

| File | Purpose |
|------|---------|
| `bin/forge-status.js` | Status line — registry-driven derivation, project identity, pipeline stage progress, gate distinction (gate1/gate2), multi-pipeline fanout with overflow. Registry authoritative over run-active.json (completed runs don't render as active). |
| `bin/forge-worktree.js` | Worktree manager (create, list, merge with auto-commit + conflict safety, cleanup). On merge conflict: persists `mergeBlocked` on the run, aborts, preserves worktree/branch, exits non-zero. |
| `forge-banner.txt` | Shared banner text consumed by `ctx-post-tool.js` for first-response rendering |
| `scripts/forge-wrapper-proto.mjs` | Primary terminal dashboard surface (prototype). Spawns Claude in a node-pty child, renders it via `@xterm/headless` into a blessed left pane, polls `buildDashboardState()` into a right pane every 2s. Mouse wheel scrolls the Claude pane; quit via `Ctrl+B` then `Q`. |
| `scripts/forge-observer.mjs` | Primary terminal dashboard surface. Standalone full-screen Ink (React) dashboard using `buildDashboardState()`; user runs it in a separate terminal pane next to native `claude`. Read-only; polls every 2s. Keyboard: `r` refresh, `q`/`Q`/`Ctrl+C` quit. SGR mouse: any left-click triggers a refresh; `Shift`+click-drag is the user-side text-selection gesture. |
| `scripts/dashboard-server.mjs` | Legacy local HTTP sidecar (Node built-in `http`, zero deps). `GET /` serves self-contained HTML dashboard. `GET /api/dashboard-state` returns JSON from `buildDashboardState()`. `POST /api/gate-action` handles approve/discard. `POST /api/merge-action` retries a merge-blocked worktree. Loopback-only (127.0.0.1), port 7878. Unwired from `package.json` — run directly via `node scripts/dashboard-server.mjs` during the transition phase. Scheduled for removal once the wrapper TUI is fully validated. |
| `scripts/png-to-sprite.mjs` | PNG → half-block + truecolor terminal sprite converter. Reads PNG via `pngjs`, renders upper-half-block (U+2580) cells with `\x1b[38;2;…m` / `\x1b[48;2;…m` SGR. Supports `--trim` (crop transparent/white padding) and `--scale N` (integer downscale with per-block averaging). Reusable asset pipeline for future wrapper worker cards. |
| `scripts/forge-banner-truecolor.js` | Stashed truecolor FORGE banner (Braille-pattern flame + RGB-gradient bitmap text). Verbatim lift from the legacy Electron app's `banner.js`. Not wired to any hook or wrapper yet — kept as a future splash asset. Reads `.forge` in cwd (Electron-era identity path); a port to `.pipeline/project.json` is pending. |

### Templates (3 template sets)

| Directory | Purpose |
|-----------|---------|
| `templates/code/` | Standard code project scaffold (agents, CLAUDE.md, docs — no hooks, no hook settings) |
| `templates/instructional/` | Instructional/learning project scaffold (no hooks, no hook settings) |
| `templates/power-automate/` | Power Automate project scaffold (no hooks, no hook settings) |

Templates do not ship `.claude/hooks/` or hook registrations in `.claude/settings.json`. All hooks are provided centrally by the plugin via `hooks/hooks.json`.

### Per-project state (created by /forge:init)

| File | Purpose |
|------|---------|
| `.pipeline/board.json` | Task board (TODO/PLANNED) |
| `.pipeline/project.json` | Project config (stacks, mode) |
| `.pipeline/modules.json` | Module registry |
| `.pipeline/agent-roles.json` | Agent write permissions |
| `.pipeline/runs/` | Run registry |
| `.pipeline/gate-pending.json` | Current gate state pointer (transient). Carries `runId` for deterministic targeting. |
| `.pipeline/run-active.json` | Session-level marker pointing at most recent run. Includes `currentUnit: { agent, startedAt }` written by `subagent-start.js`, cleared by `subagent-stop.js` — used by `/forge:resume` and SessionStart to detect stale-lock mid-run state. Registry is authoritative — `forge-status.js` cross-checks before treating as active. |
| `.pipeline/forge-banner-pending` | Flag file written by SessionStart hook, consumed by first PostToolUse to inject banner once per session |
| `.pipeline/usage.json` | Provider usage tracking |
| `.claude/forge-status.cmd` | Project-local statusLine wrapper (Windows). Embeds absolute Node path via `process.execPath`, generated by `/forge:init`. Avoids bare-`node` PATH dependency. |
| `.claude/settings.json` | Project Claude Code settings — `statusLine.command` points to `.claude/forge-status.cmd` after init |
| `docs/PLAN.md` | Active plan |
| `docs/ARCHITECTURE.md` | Project architecture |
| `docs/CHANGELOG.md` | Change log |
| `docs/context/handoff.md` | Implementation draft |
| `docs/context/slice-brief.md` | Scoped implementation brief (from implementation-architect) |
| `docs/context/scout.json` | Coder scout results |
| `docs/gotchas/GENERAL.md` | Project-specific conventions |
| `docs/RESEARCH/*.md` | Research findings |
| `docs/solutions/` | Solution knowledge store |

---

## 15. Documentation Structure

| Tier | Document | Purpose |
|------|----------|---------|
| Overview | `docs/FORGE-OVERVIEW.md` | Story of FORGE — Eras, philosophy, competitive positioning |
| Reference | `docs/FORGE-REFERENCE.md` | Complete technical reference (this document) |
| Recipe | `docs/FORGE-OVERVIEW-RECIPE.md` | How to update overview and reference |
| Decisions | `docs/DECISIONS.md` | Non-obvious architecture decisions |

Other docs: `docs/PLAN.md` (active plan), `docs/CHANGELOG.md` (change log), `docs/ARCHITECTURE.md` (module map), `docs/gotchas/GENERAL.md` (gotchas).

---

## Source files read during generation

`.claude-plugin/plugin.json`, `CLAUDE.md`, `docs/gotchas/GENERAL.md`, `docs/CHANGELOG.md`, `forge-config.default.json`, `.pipeline/board.json`, `.pipeline/modules.json`, `hooks/hooks.json`, `mcp/server.js`, `mcp/lib/config-store.js`, `mcp/lib/router.js`, `mcp/lib/usage-store.js`, `mcp/lib/openai-adapter.js`, `mcp/lib/dashboard-state.js`, `packages/forge-core/src/runs/schemas.js`, all `agents/*.md` (29 files), all `skills/*/SKILL.md` (21 files), all `hooks/*.js` (13 files).
