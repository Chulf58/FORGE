---
name: plan
description: "Run the FORGE plan feature pipeline. Use when: user wants to plan a new feature, asks 'plan this', or describes a feature to build."
argument-hint: "[feature description]"
context: fork
allowed-tools: "Read Write Glob Grep Agent"
model: claude-sonnet-4-6
---

## STEP 1 — Create run (MANDATORY — do this FIRST, before anything else)

Immediately call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"plan"`
- `mode`: `"LEAN"` (will be updated after mode decision in Step 3)
- `feature`: a short summary derived from the user's input below

Save the returned `runId`. You MUST reference it in later steps.

Then call `forge_update_run` with that `runId` and `status: "running"`, `currentStep: "brainstormer-decision"`.

Do NOT skip this step. Do NOT check for existing runs first. Every /forge:plan invocation creates exactly one new run.

## STEP 2 — Brainstormer decision

Read the feature request below. Check these signals:

**Skip brainstormer when ANY of these are true:**
- Input has numbered acceptance criteria (e.g. "(1) does X, (2) handles Y")
- Input names specific file paths
- Input has "Affected areas:" section
- Input specifies the technical approach
- Input is longer than 200 words with clear deliverables

**Invoke brainstormer when:**
- Input is short and vague
- Input describes a goal without specifics
- Input uses exploratory language ("something like", "maybe", "make it")

If brainstormer needed: invoke the **brainstormer** agent. It asks questions via [questions] signal. After answers, it writes a requirements doc to `docs/brainstorms/`. Then continue to Step 3.

If brainstormer skipped: continue to Step 3 directly.

## STEP 3 — Decide pipeline mode (AFTER brainstormer)

Now that you have full context (either from the brainstorm doc or from the detailed input), assess the scope:

Prefer MCP tool `forge_read_project` for the project's `pipelineMode` setting. Fall back to reading `.pipeline/project.json` if MCP unavailable. The mode is the **floor** — you can escalate but not go below it.

Assess based on what you now know:
- **LEAN** — simple change, few files, low risk, clear approach
- **STANDARD** — multiple files, some complexity, cross-module state changes
- **FULL** — high risk, security-sensitive, architectural impact

Present: "Pipeline: plan feature | Mode: <MODE> | <agent list>"

If the user already approved in a prior message, proceed. Otherwise wait for approval.

## Model routing (optional)

Before spawning each agent, you may call `forge_get_model_recommendation` with the agent name and budget mode to check the optimal model. If the recommendation differs from the agent's frontmatter `model:` field, pass the recommended model via the Agent tool's `model` parameter. This is advisory — if the MCP tool is unavailable, use the frontmatter default.

## STEP 4 — Update run with final mode

Call `forge_update_run` with the `runId` from Step 1 and `mode`: the mode you decided in Step 3. Also set `currentStep: "planner"`.

## STEP 5 — Run planner pipeline

1. **Planner:** reads brainstorm doc (if exists), GENERAL.md, codebase. Writes `docs/PLAN.md`. The planner does NOT ask questions.
2. **Conditional researcher:** read `### Research needed` in PLAN.md. Skip if absent/empty.
3. **Gotcha-checker** (STANDARD/FULL only): check plan against pitfalls.
4. **Reviewer-triage → reviewers:** dispatch based on mode decided in Step 3.
5. **Gate #1:** First update the run, then write gate state:
   - Call `forge_update_run` with the `runId`, `status: "gate-pending"`, `currentStep: "gate1"`, and `gateState: {"gate":"gate1","status":"pending","feature":"<feature name>","createdAt":"<now ISO>"}`
   - Write `.pipeline/gate-pending.json`: `{"gate":"gate1","feature":"<feature name>","status":"pending","plan":"docs/PLAN.md"}`
   - Present the plan summary to the user
   - Ask user to type /forge:approve or /forge:discard

## Feature request
$ARGUMENTS
