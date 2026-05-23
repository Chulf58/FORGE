---
name: forge:plan
description: "Run the FORGE plan feature pipeline. Use when: user wants to plan a new feature, asks 'plan this', or describes a feature to build."
argument-hint: "[feature description]"
allowed-tools: "Read Write Glob Grep Agent"
model: claude-sonnet-4-6
---

## STEP 1 — Phase A: user interview + classify risk + create run (conductor)

### Phase A — User interview (grill-intent Skill)

1. **Knowledge pre-load:** Before invoking the grill-intent skill, call:
   - `forge_get_constraints` with keywords from the feature description
   - `forge_get_patterns` with module/file names mentioned in the feature description
   These results give the grill-intent skill and planner access to project-specific constraints without re-deriving them.

2. **Track Phase A start:** Call `forge_update_run` with `phases[{index:0, label:"Phase A — user interview", status:"running"}]`.
   (If no runId exists yet, skip this call — it happens before `forge_create_run`. The phase update after creation uses the resolved runId.)

3. **Invoke grill-intent:** Invoke `Skill(grill-intent)` with the feature description as the argument. Do NOT prepend any `[pipeline-mode:]` signal — the grill-intent skill manages its own flow and Q&A with the user.

   The grill-intent skill:
   - Conducts a structured user interview about intent, constraints, and acceptance criteria
   - Writes `docs/brainstorms/<slug>.md` (the ground-truth brainstorm doc)
   - Stores `brainstormSlug` in run state automatically (or writes it to a known context path)

   If grill-intent fails or produces no brainstorm doc (rare — agent crash), log `[plan] grill-intent did not produce brainstorm doc — continuing without ground truth` and proceed. Downstream agents derive intent from the feature heading.

4. **Track Phase A complete:** After grill-intent returns, call `forge_update_run` with `phases[{index:0, status:"completed"}]`.

### 1c. Classify risk and present agent team

After Phase A completes, **call `forge_classify_risk`** with:
- `feature`: a short summary derived from the brainstorm doc (preferred) or from the original user input
- `filePaths`: `[]` (no files known at plan stage)
- `forceReview`: `true` if the original user input contained the literal token `[force-review]`, otherwise `false`

Present the classification result to the user:
```
Risk classification:
  Risk level:        <riskLevel>
  Triggered rules:   <advisories joined by ", " or "none">
  Plan-stage review: <planStageReview>
  Suggested reviewers: <reviewers joined by ", " or "none">
```

Present the resolved agent team to the user before proceeding:
```
Agent team for this run:
  Core agents:  planner, gotcha-checker[, researcher — if research needed]
  Reviewers:    <reviewers from forge_classify_risk, or "none">
```
Waiting for approval — type 'approve' to proceed, or describe changes to the team

### 1d. Create run and proceed to STEP 2 (only after user approves)

Call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"plan"`
- `feature`: a short summary derived from the brainstorm doc
- `spawnWorker`: `false`
- `classificationId`: the `classificationId` value from the `forge_classify_risk` result
- `reviewerOverrides`: the `reviewers` array from the `forge_classify_risk` result
- `stages`: `{ "plan": { "agents": ["planner"], "status": "pending" } }`

Report to the user:
- Run ID: `<runId>`
- "Proceeding directly to planner pipeline in this session."

**Note on token budget:** The full conductor-session plan pipeline (Phase B through gate1) consumes approximately 10K tokens per reviewer dispatch for a 20-task plan. Measure actual usage on the first pilot run and tune if needed.

After run creation, proceed **directly** to STEP 2 in this same conductor session — do NOT exit.

## STEP 2 — Planner pipeline (conductor session)

All phases below run in the **conductor session** — there is no separate worker process for plan runs.

**Before dispatching agents:**

1. Call `forge_get_run` with the `runId` from Step 1d. Extract `stages.plan.agents` — this is the list of agents to dispatch for the plan stage.
2. Dispatch exactly the agents listed in `stages.plan.agents`.

### Phase B — Planner + researcher + gotcha-checker

1. **Planner:** reads brainstorm doc (if exists), GENERAL.md, codebase. Writes `docs/PLAN.md`. The planner does NOT ask questions.

2. **Conditional researcher:** read `### Research needed` in PLAN.md. Skip if absent/empty.

3. **Gotcha-checker + Researcher (concurrent when both needed):** If both gotcha-checker and researcher are needed (researcher not skipped), spawn them in a single concurrent Agent dispatch (one tool call, two agents). If only one is needed, run it sequentially.

4. Call `forge_update_run` with `phases[{index:1, label:"Phase B — planner", status:"completed"}]` after Phase B agents finish.

### Phase C — Plan walkthrough (grill-plan Skill)

NOTE: Phase C runs in the CONDUCTOR session, not a worker.

1. Call `forge_update_run` with `phases[{index:2, label:"Phase C — plan walkthrough", status:"running"}]`

2. Invoke `Skill(grill-plan)` — the skill reads `brainstormSlug` from run state, cross-references the brainstorm doc against PLAN.md, does a one-at-a-time Pocock-style walkthrough with the user, applies inline edits, and appends `## Walkthrough deltas` to PLAN.md.

   If grill-plan cannot locate `brainstormSlug` in run state (e.g., grill-intent failed or run state was reset), log `[plan] brainstormSlug missing — skipping brainstorm cross-reference` and proceed to Phase D with PLAN.md as written. The walkthrough continues without the brainstorm comparison.

3. After the skill returns, call `forge_update_run` with `phases[{index:2, status:"completed"}]`

### Phase D — Reviewer dispatch

Determine which reviewers to invoke via the deterministic dispatcher script.

- **Clear stale reviewer output first.** Delete every `*.md` file under `.pipeline/context/reviewer-output/` before dispatching reviewers. Without this, a stale file from a previous run blocks the new reviewer's Write call (Claude Code refuses to Write to a file that has not been Read in the current session — observed silent failure on r-ad7b145e and r-d5b1ccd9). Run via Bash: `find .pipeline/context/reviewer-output -maxdepth 1 -name '*.md' -delete 2>/dev/null || true` — if the directory doesn't exist yet, the command is a no-op. Do not block on the cleanup.
- Run via Bash: `node scripts/reviewer-dispatch.mjs --plan=docs/PLAN.md --stage=plan --run-id=<runId>`.
- Capture the stdout JSON (shape: `{ "reviewers": [...], "reasons": [...] }`).
- Log: `[reviewer-dispatch] reviewers=[<comma-joined>] reasons=[<comma-joined>]`.
- **Before spawning each reviewer**, prepend TWO signal lines to the reviewer's prompt so the reviewer writes its verdict to the per-run directory AND reads the plan from the correct path:

  > `[reviewer-output-dir: .pipeline/context/reviewer-output/]`
  > `[plan-path: docs/PLAN.md]`

- **For `technical-skeptic` only**, also prepend the planner-model signal so the cross-model verdict tag works:

  > `[planner-model: <family>]`

  Resolve `<family>` by calling `forge_get_model_recommendation({ agent: "planner" })` and using the returned model family (sonnet | opus | haiku). If the call errors or returns null, omit this line — technical-skeptic's own fallback path handles the missing signal.

- Dispatch exactly the reviewers listed in `reviewers[]`. Use `forge_get_model_recommendation` for each. Pass `[plan-stage review]` prefix in each reviewer's prompt. No reviewer-triage agent.

- **Dispatch reviewers in PARALLEL with `run_in_background: true`.** Every reviewer Agent call MUST pass `run_in_background: true` so all reviewers run truly concurrently and the conductor regains control immediately after dispatch. Without this, dispatches serialize — wasting the multi-reviewer parallelism. After dispatch, the conductor proceeds to Phase E processing. The conductor MUST wait for ALL background reviewers to complete (via task-notification events) before reading verdicts in Phase E. Do not advance to Phase E mtime-checks until every dispatched reviewer's task-notification has fired (either with a verdict file written or a truncated status). Evidence: r-a45d9be6 (2026-05-22) — first plan run to use parallel reviewer dispatch; 4 reviewers ran concurrently in ~67s, would have serialized to ~270s otherwise.

### Phase E — Per-finding dialogue (REVISE loop)

Track a revision counter `M` (starts at 0). Maximum iterations: 2. When M >= 2 and REVISE is still unresolved, gate1 OPENS with a `revisingUnresolved: true` marker — the conductor can fix PLAN.md inline before approving gate1.

**Before reading verdicts**, mtime-check each reviewer's verdict file. For each reviewer in the dispatched list, run:
`node scripts/verify-output.mjs --file=.pipeline/context/reviewer-output/<reviewer>.md --since=<reviewerStartedAtMs>`
where `reviewerStartedAtMs` is the epoch-ms timestamp recorded when that reviewer was spawned.
- Exit 0: verdict file is fresh — accept the signal.
- Exit 1 or exit 2: verdict file is absent or stale — treat as **no-verdict**. Log: `[verdict-check] <reviewer> verdict file stale or missing — treating as no-verdict`. A no-verdict is treated as REVISE-unresolved.

**If ANY reviewer emitted BLOCK:** Write gate1 immediately — no dialogue. See gate1 write format below (BLOCK path). Log the block reason.

**Per-finding dialogue (REVISE or no-verdict):**

Collect all REVISE findings from reviewer output files that passed the mtime check (in `.pipeline/context/reviewer-output/`). For each finding, present to the user:

```
[Phase E] Reviewer finding: <reviewer>
AC-<N>: <finding summary>
"<verbatim cited phrase>"

[my-rec] <conductor's one-sentence recommendation>

Your call: accept | modify | dismiss
```

User response handling:
- **accept**: Edit PLAN.md with the suggested fix; append `<!-- Resolution: <finding-id> accepted — <what changed> -->` to PLAN.md.
- **modify**: User states desired change; conductor applies it to PLAN.md; append `<!-- Resolution: <finding-id> modified — <what changed> -->`.
- **dismiss**: No PLAN.md edit; append `<!-- Resolution: <finding-id> dismissed by user -->` to PLAN.md.

**After ALL findings in the current round are resolved:**

Check `[needs-researcher]` signals: scan reviewer output files for `[needs-researcher]: <question>` signals. If any reviewer emitted this signal, the finding requires factual verification. In that case: dispatch researcher before re-invoking the planner. The researcher output will be written to `docs/RESEARCH/` and available as context for the planner revision.

Increment M (AFTER dialogue round, BEFORE planner re-invocation).

**Condition table (evaluated top-to-bottom; first matching row wins):**

| Priority | Outcome after dialogue round | Action |
|----------|------------------------------|--------|
| 1 | Any BLOCK verdict | Gate1 with blockedBy (no dialogue — BLOCK is conductor decision) |
| 2 | M >= 2 after increment | Gate1 with `revisingUnresolved: true` |
| 3 | ≥1 finding accepted/modified | Increment M; re-invoke planner `[revision-mode: M]` + `[failed-criteria: AC-X,...]`; re-dispatch same reviewers |
| 4 | All findings dismissed | No planner re-invocation — proceed to gate1 |

**M >= 2 mid-dialogue:** If M reaches 2 while a dialogue round is still in progress (before all findings are resolved), suspend the dialogue immediately — do NOT silently abandon unresolved findings. Open gate1 with `revisingUnresolved: true`. The user decides whether to approve (accepting remaining unresolved findings) or discard, with full reviewer feedback intact in `.pipeline/context/reviewer-output/`.

**Planner re-invocation (when ≥1 accepted/modified):**

1. Collect all `AC-<N>: NOT_MET` lines from reviewer output files in `.pipeline/context/reviewer-output/`. Extract the AC-IDs (e.g. `AC-2`, `AC-4`).
2. Re-invoke the planner with `[revision-mode: M]` prepended to its prompt. If the failed-criteria list is non-empty, also prepend `[failed-criteria: <comma-joined AC-IDs>]`. Pass all REVISE warnings as context.
3. After the revised planner writes the updated `docs/PLAN.md`, re-clear stale reviewer output (same `find ... -delete` command as Phase D) and re-dispatch the **same reviewer set** using the updated PLAN.md (no re-classification — same `--plan=docs/PLAN.md --stage=plan` invocation). Return to the top of Phase E verdict processing with the updated `M`.

> The `scripts/plan-revise-loop.mjs` helper is the pure-function reference implementation of this loop. The loop behavior described above must remain aligned with `runPlanReviseLoop` in that module — if the loop logic changes, update both.

### Gate #1

Write gate file first, then update the run (run status change triggers observer, so the file must exist first):

**Plan-extractor dispatch (before gate1 suspends):**
After writing the gate1 file, dispatch `plan-extractor` via Agent tool call with the runId injected:
- Pass `[run-id: <runId>]` as the first line of the agent's prompt so plan-extractor can read `brainstormSlug` from run state via `forge_get_run`
- The agent runs asynchronously — do not await its completion; gate1 is written and `forge_update_run` proceeds immediately after dispatch
- If plan-extractor fails or times out, gate1 remains open; conductor handles the missing proposals file per the "Post-gate1 knowledge proposals" section below

**Clean gate1 (APPROVED or M=0):** Write `.pipeline/gate-pending.json`: `{"runId":"<runId>","gate":"gate1","feature":"<feature name>","status":"pending","plan":"docs/PLAN.md"}`. Call `forge_update_run` with the `runId`, `status: "gate-pending"`, and `gateState: {"gate":"gate1","status":"pending","feature":"<feature name>","createdAt":"<now ISO>"}`.

**BLOCK gate1:** Write `.pipeline/gate-pending.json`: `{"runId":"<runId>","gate":"gate1","feature":"<feature name>","status":"pending","plan":"docs/PLAN.md","blockedBy":{"reviewer":"<reviewer name>","reason":"<first line of the violation>"}}`. Call `forge_update_run` with the `runId`, `status: "gate-pending"`, and `gateState: {"gate":"gate1","status":"pending","feature":"<feature name>","createdAt":"<now ISO>","blockedBy":{"reviewer":"<reviewer name>","reason":"<first line of the violation>"}}`. Log the block reason. The run is NOT marked failed — observer surfaces the BLOCK reason via the `blockedBy` gateState field for conductor decision. Reviewer output remains at `.pipeline/context/reviewer-output/` for conductor inspection.

**Unresolved gate1 (M>=2 REVISE):** Write `.pipeline/gate-pending.json`: `{"runId":"<runId>","gate":"gate1","feature":"<feature name>","status":"pending","plan":"docs/PLAN.md","revisingUnresolved":true}`. Call `forge_update_run` with the `runId`, `status: "gate-pending"`, and `gateState: {"gate":"gate1","status":"pending","feature":"<feature name>","createdAt":"<now ISO>","revisingUnresolved":true}`. Log: `[plan-revise-loop] M=2 unresolved — opening gate1 with revisingUnresolved marker`.

Present the plan summary to the user; include the path `docs/PLAN.md`. If `revisingUnresolved` is true, also display: "Note: Reviewers requested changes that were not fully resolved after 2 planner revision passes. Review the REVISE feedback in `.pipeline/context/reviewer-output/` before approving."

Ask user to type /forge:approve or /forge:discard — the implement worker will start automatically on approval.

### Post-gate1 knowledge proposals (conductor, after gate1 is pending)

This is CONDUCTOR-side work. It runs in-session immediately after gate1 opens, before the user reviews the plan. `brainstormSlug` is stored in run state by the grill-intent skill (Phase A) — plan-extractor reads it from there via `forge_get_run`.

Read `.pipeline/runs/<runId>/plan-extractor-proposals.json`.

**If file is missing, malformed, or has an empty `candidates` array:** Surface inline to the user:

```
[plan-extractor] proposals file unavailable — knowledge base capture SKIPPED for this run.
                 Apply-stage learnings-extractor will still run later if implement completes.
                 Continue to gate1 finalization? (yes / retry plan-extractor / discard run)
```

User picks:
- `yes` → proceed to gate1 finalize (ask user to type /forge:approve or /forge:discard as normal)
- `retry` → re-dispatch plan-extractor once with the same `[run-id: <runId>]` signal; wait for it to complete; re-read the proposals file; if still missing/empty, treat as `yes` and log `[plan-extractor] retry produced no candidates — continuing`
- `discard` → call `forge_kill_run` with the runId and stop

**If file exists with one or more candidates: auto-accept all (no per-candidate user interaction).**

For each candidate in the proposals file, the conductor calls `forge_add_learning` directly with `type: <type>`, `title: <title>`, `content: <body>`. No surfacing, no yes/no/edit dialogue, no per-candidate user wait.

**Conflict-detect handling** — `forge_add_learning` may return `{conflict: true, slug: <existing-slug>}` indicating a similar existing entry. Retry policy:
1. Retry ONCE with a more distinctive title — append a disambiguator drawn from the candidate's most distinctive tag or sub-topic (e.g., original "Brainstorm attribution" + tag "phase-c" → retry title "Brainstorm source attribution — separate user-stated from conductor-proposed").
2. If the retry also conflicts, log `[plan-extractor] candidate <id> skipped — conflict-detect persistent` and move on. Do NOT retry further; do NOT surface to user mid-loop.

After ALL candidates are processed (accepted, conflict-skipped, or errored), emit a single summary line:

```
[plan-extractor] <accepted> learnings added, <skipped> skipped due to conflict, <total> candidates processed.
```

Then proceed to gate1 finalization. The user reviews the additions in the morning (or post-loop) via `forge_get_patterns` / `docs/solutions/` if they want to audit — but mid-loop user interaction is no longer required.

**Rationale for auto-accept (trade-off):** Speed prioritized over per-candidate nuance. Edits like the r-a45d9be6 p4 case (plan-extractor framed conductor discipline as user discipline, needed correction) will ship with the original framing unless the user later edits the saved entry. Acceptable cost given the user's typical accept rate is >80% in manual mode (r-a45d9be6: 4 yes + 1 edit + 0 no = 100% acceptance).

## Feature request
$ARGUMENTS
