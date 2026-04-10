Run the FORGE plan feature pipeline.

## STEP 1 — Brainstormer decision

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

If brainstormer needed: invoke the **brainstormer** agent. It asks questions via [questions] signal. After answers, it writes a requirements doc to `docs/brainstorms/`. Then continue to Step 2.

If brainstormer skipped: continue to Step 2 directly.

## STEP 2 — Decide pipeline mode (AFTER brainstormer)

Now that you have full context (either from the brainstorm doc or from the detailed input), assess the scope:

Read `.pipeline/project.json` for the project's `pipelineMode` setting. This is the **floor** — you can escalate but not go below it.

Assess based on what you now know:
- **LEAN** — simple change, few files, low risk, clear approach
- **STANDARD** — multiple files, some complexity, IPC or state changes
- **FULL** — high risk, security-sensitive, architectural impact

Present: "Pipeline: plan feature | Mode: <MODE> | <agent list>"

If the user already approved in a prior message, proceed. Otherwise wait for approval.

## STEP 3 — Run planner pipeline

1. **Planner:** reads brainstorm doc (if exists), GENERAL.md, codebase. Writes `docs/PLAN.md`. The planner does NOT ask questions.
2. **Conditional researcher:** read `### Research needed` in PLAN.md. Skip if absent/empty.
3. **Gotcha-checker** (STANDARD/FULL only): check plan against pitfalls.
4. **Reviewer-triage → reviewers:** dispatch based on mode decided in Step 2.
5. **Gate #1:** Write gate state FIRST, then present summary:
   - Write `.pipeline/gate-pending.json`: `{"gate":"gate1","feature":"<feature name>","status":"pending","plan":"docs/PLAN.md"}`
   - Present the plan summary to the user
   - Ask user to type /forge:approve or /forge:discard

## Feature request
$ARGUMENTS
