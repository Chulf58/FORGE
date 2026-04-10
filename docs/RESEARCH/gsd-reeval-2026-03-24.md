# GSD Re-Evaluation Audit — 2026-03-24

## Overview

This is the full audit report for the Get-Shit-Done (GSD) re-evaluation of the FORGE pipeline. The original GSD criteria were encoded as two todo entries (`gsd5-e5f6` and `gsd3-c3d4`) defining a 10-dimension quality model for the planning and execution pipeline. Since that baseline, FORGE has shipped multiple features directly targeting these dimensions. This report scores all 10 dimensions against the current codebase and documents the gap analysis.

The Implementer should copy this report verbatim to `docs/RESEARCH/gsd-reeval-2026-03-24.md`.

---

## Evidence Sources Read

1. `.claude/agents/gotcha-checker.md` — full file, all dimension checks enumerated
2. `.pipeline/board.json` — original GSD todo entries for baseline extraction
3. `.pipeline/features.json` — shipped features list with summaries
4. `.claude/agents/implementer.md` — wave execution protocol and self-check sections
5. `.claude/agents/reviewer.md`, `reviewer-logic.md`, `reviewer-safety.md`, `reviewer-style.md`, `reviewer-performance.md` — verdict signal presence
6. `src/main/shared.ts` — `filterSkillsByStacks` implementation and `buildSystemPromptAppend` integration
7. `src/main/handlers/pipeline-data.ts` — `append-verdict` and `get-verdicts` handlers
8. `src/renderer/src/components/panels/HealthPanel.svelte` — verdict UI completeness

---

## Pre-Audit Baseline (from GSD todo entries)

The two GSD todo entries defined the original 10-dimension intent before any implementation work:

**From `gsd5-e5f6-4a7b-c8d9-plan-checker`:**

> "GSD #5 — Plan checker 9-dimension validation: add to gotcha-checker: (1) scope sanity — flag plans with ≥5 tasks as warning, ≥8 as blocker; (2) requirement coverage — every item in ROADMAP.md phase entry maps to a task; (3) goal-backward framing — must-haves trace to user-observable outcomes not internal state; (4) dependency correctness — acyclic graph, no broken references; (5) key links — critical connections are concrete not vague; (6) verification derivability — acceptance criteria are observable; (7) context compliance — no contradictions with locked decisions; (8) Nyquist compliance — each wave has runnable verification; (9) cross-plan data contracts — shared types are compatible; (10) token budget — task×file count threshold"

**From `gsd3-c3d4-4e5f-a6b7-wave-execution`:**

> "GSD #3 — Wave-based parallel execution: at plan time assign each plan a wave: number (dependency graph traversal — no deps = wave 1; depends on wave-1 = wave 2); file ownership rule: two plans touching the same file must be sequential (later declares depends_on); at execute time orchestrator spawns one executor per plan in a wave in parallel, passes file paths not content (keeps orchestrator at ~10-15% context), verifies cross-plan key-links before next wave; context-lean orchestrator pattern also worth adopting independently of parallelism"

### Pre-Audit Baseline Table (10 Dimensions)

| Dim | Name | GSD Origin | Pre-Audit Status |
|-----|------|------------|-----------------|
| 1 | Scope sanity | GSD #5 | NOT STARTED |
| 2 | Requirement coverage | GSD #5 | NOT STARTED |
| 3 | Goal-backward framing | GSD #5 | NOT STARTED |
| 4 | Dependency correctness | GSD #5 | NOT STARTED |
| 5 | Key links concreteness | GSD #5 | NOT STARTED |
| 6 | Verification derivability | GSD #5 | NOT STARTED |
| 7 | Context compliance | GSD #5 (+ skills wiring feature) | NOT STARTED |
| 8 | Nyquist compliance | GSD #5 | NOT STARTED |
| 9 | Cross-plan data contracts | GSD #5 | NOT STARTED |
| 10 | Token budget | GSD #5 | NOT STARTED |

All 10 dimensions were NOT STARTED at baseline. The GSD #3 wave execution dimension maps across dimensions 4, 8, and partially 9 (cross-wave file ownership).

---

## Dimension-by-Dimension Scorecard

### Dimension 1 — Scope Sanity

**Claim:** Flag plans with ≥5 tasks as WARNING, ≥8 tasks as BLOCKER.

**Evidence:** `gotcha-checker.md` contains `## Scope sanity check` section verbatim. The BLOCKER threshold (`count >= 8`) and WARNING threshold (`count >= 5 and < 8`) are present with exact output format strings. The check counts task items under the active (non-`[x]`) feature heading only.

**Score: SHIPPED**

The implementation precisely matches the GSD spec. Both thresholds are active BLOCKER/WARNING checks.

---

### Dimension 2 — Requirement Coverage

**Claim:** Every item in the active ROADMAP.md phase maps to a task in the plan.

**Evidence:** `gotcha-checker.md` contains `## Requirement coverage check`. The agent reads `docs/ROADMAP.md` only if it exists, finds the first non-`[x]` `##` heading, collects bullets, extracts first-5-non-stopword-tokens per bullet, and checks for any matching task. Emits WARNING per unmatched bullet. Skips silently if ROADMAP.md is absent.

**Score: SHIPPED**

The implementation is fully in place. The check is conditional on ROADMAP.md's existence — when absent, it is silent (correct per spec). No ROADMAP.md is present in this project, so the check runs silently on every plan currently.

---

### Dimension 3 — Goal-Backward Framing

**Claim:** Must-haves trace to user-observable outcomes, not just internal state changes.

**Evidence:** `gotcha-checker.md` contains `## Goal-backward framing check`. The section classifies each task as User-observable or Internal-only and emits a WARNING if all tasks are internal-only. User-observable criteria include: UI elements, displayed values, buttons, terminal messages, files written to disk, agent signals emitted, modals, settings toggles. Internal-only examples include: adding fields to DEFAULT_SETTINGS, updating type definitions, removing dead constants, adding helper functions.

**Score: SHIPPED (coarse)**

The dimension is present by name and has a concrete implementation. However, the check fires only when all tasks are internal-only. A plan where 9 of 10 tasks are internal but one has a single vague user-observable mention passes silently. This is a known limitation: the current implementation detects the degenerate case (zero observable tasks) but does not enforce that each individual internal task has a traceable user outcome.

**Partial gap:** The original GSD intent was that each must-have traces to an outcome, not just that the plan is not entirely internal. The current implementation is necessary but not sufficient for the full GSD dimension.

---

### Dimension 4 — Dependency Correctness

**Claim:** Acyclic dependency graph, no broken references. Wave numbers contiguous, no invalid task cross-references.

**Evidence:** `gotcha-checker.md` contains `## Dependency correctness check`. Steps: (1) collect distinct wave numbers; (2) verify contiguous sequence starting at 1; (3) scan for "depends on task N" / "see task N" phrases and verify referenced task numbers exist. BLOCKER emitted for wave gaps; BLOCKER emitted for invalid cross-references. Silently passes when no wave annotations are present.

`implementer.md` contains `## Wave execution protocol`: implementer parses `(wave: N)` annotations, groups tasks by wave, processes waves in ascending order, and emits `[blocked]` when a prerequisite from the prior wave is absent before starting the next wave.

`implementer.md` contains `## Wave self-check`: after completing each wave, the implementer reads each target file and confirms the expected change is present before emitting `[wave-complete] N`. If any change is missing, it emits `[blocked]` and stops.

**Score: SHIPPED**

Both plan-time checking (gotcha-checker) and execution-time enforcement (implementer wave self-check plus `[blocked]` signal) are in place. The GSD intent of verifying cross-plan key-links before proceeding to the next wave is covered by the implementer's prerequisite-verification step.

**Note on parallelism:** The original GSD #3 todo described parallel execution within a wave. The shipped implementation processes tasks in a wave serially. This was a deliberate scope reduction, not a missed dimension. Parallelism within a wave remains unimplemented.

---

### Dimension 5 — Key Links Concreteness

**Claim:** Critical connections (IPC channels, type contracts, file paths) are concrete and specific, not vague.

**Evidence:** No dedicated `## Key links` section exists in `gotcha-checker.md`. The full file was read and no section heading or check body explicitly validates whether descriptions of connections between plan elements are concrete versus vague.

Adjacent checks provide partial coverage: the IPC-completeness check (four-quadruple check) enforces structural completeness, and the cross-plan data contracts check (dimension 9) validates type shape consistency. Neither checks whether plan prose uses concrete identifiers.

**Score: GAP**

Dimension 5 has no dedicated implementation. The original spec text was: "key links — critical connections are concrete not vague." No check currently flags a task that says "wire the component to the existing IPC layer" without naming the specific channel, handler file, or type in backticks. The implementer then makes assumptions that diverge from coder intent, producing reviewer blocks.

---

### Dimension 6 — Verification Derivability

**Claim:** Acceptance criteria are observable — at least one task describes how correctness can be confirmed.

**Evidence:** `gotcha-checker.md` contains `## Verification derivability check`. Scans all task descriptions for observable keywords (case-insensitive): `visible`, `displays`, `renders`, `shows`, `emits`, `returns`, `observable`, `confirm`, `verify`, `test`, `assert`, `user can`, `should see`, `expected output`. Emits WARNING if zero tasks contain any keyword. WARNING only, never BLOCKER.

**Score: SHIPPED**

The check is present and functional. Same coarse-filter characteristic as dimension 3: detects the degenerate case rather than requiring each task to individually state a verification criterion. This is acceptable for a plan-checker.

---

### Dimension 7 — Context Compliance

**Claim (GSD #5):** No contradictions with locked decisions in DECISIONS.md.

**Claim (skills wiring feature):** Agent prompts are filtered to only the tech stack sections relevant to the active project.

**Evidence (DECISIONS.md check):** `gotcha-checker.md` contains `## Context compliance check`. Reads DECISIONS.md if it exists, extracts decision entries, scans for explicit task contradictions, emits WARNING per contradiction. WARNING only. Skips silently if DECISIONS.md absent.

**Evidence (filterSkillsByStacks):** `src/main/shared.ts` implements `filterSkillsByStacks(content, stacks)`. The function parses `## AgentName` and `### StackName` sections, retains only subsections whose heading matches a requested stack (case-insensitive substring), returns full content as fallback if stacks is empty or no match found. `buildSystemPromptAppend` reads `.pipeline/project.json → techStackLabels`, passes labels to `filterSkillsByStacks`, and returns filtered content. The comment in `buildSystemPromptAppend` confirms: "Empty array means no project.json exists — full SKILLS.md is used as fallback inside filterSkillsByStacks." The integration is complete.

**Score: SHIPPED**

Both sub-dimensions are implemented. The DECISIONS.md check covers the original GSD #5 intent. The `filterSkillsByStacks` integration ensures agents receive only the context relevant to their current project stack.

---

### Dimension 8 — Nyquist Compliance

**Claim:** Each wave has at least one runnable verification / verifiable output artifact.

**Evidence:** `gotcha-checker.md` contains `## Nyquist compliance check`. Groups tasks by wave. For each group, checks whether at least one task has a verifiable output: file path in backticks, or the words `returns`, `emits`, `writes`, `creates`, `renders`, or `displays`. Emits WARNING for groups with no verifiable output. Un-annotated tasks reported as "Un-annotated tasks" group. WARNING only, never BLOCKER.

The implementer's wave self-check (dimension 4 evidence) further enforces this at execution time: each wave must produce observable file changes before proceeding.

**Score: SHIPPED**

---

### Dimension 9 — Cross-Plan Data Contracts

**Claim:** Shared types across plans (or waves) are compatible — no shape mismatches.

**Evidence (cross-plan data contracts check):** `gotcha-checker.md` contains `## Cross-plan data contracts check`. Scans task descriptions for type/interface definitions (keywords: `interface`, `type `, `schema`, `shape`, `fields:`), records type names and wave numbers, scans later-wave tasks for references to same type names, and emits WARNING when field names differ. Skips silently if no cross-wave type references found.

**Evidence (file ownership cross-wave check):** `gotcha-checker.md` contains `## File ownership cross-wave check`. Warns when tasks in different waves touch the same file path without explicit `depends on task N` reference. This is the cross-plan coordination check from GSD #3.

**Score: SHIPPED**

Both the type-shape validation and the file ownership validation are implemented. The type-shape check is limited to cases where both the defining and consuming tasks enumerate explicit field names inline — it cannot catch shape mismatches that live in actual source files rather than plan text. This is an inherent limitation of a plan-text-only checker and not a gap relative to the spec.

---

### Dimension 10 — Token Budget

**Claim:** Flag plans that are likely to exceed per-run token budget based on task count × file count.

**Evidence:** `gotcha-checker.md` contains `## Token budget check`. BLOCKER at `taskCount >= 6 AND fileCount >= 5`. WARNING at `taskCount >= 4 AND fileCount >= 4` (below BLOCKER threshold). `fileCount` is deduplicated across all task descriptions. Both thresholds produce specific output strings. Silent below both thresholds.

**Score: SHIPPED**

Both BLOCKER and WARNING thresholds are implemented. The `fileCount` deduplication is explicit in the check spec.

---

## What Shipped — Summary

| Feature | Approx Date | Dimensions Covered |
|---------|-------------|--------------------|
| GSD #5 Phase 1 — Plan Checker High-Signal Dimensions | Jan 2026 | 1, 4, 6, 8, 10 |
| GSD #5 Phase 2 — Plan Checker Conditional Dimensions | Jan 2026 | 2, 7 (DECISIONS.md), 9 |
| GSD #3 — Wave-based parallel execution | Mar 2026 | 4 (execution), 8 (execution), 9 (file ownership) |
| Skills pipeline wiring | Mar 2026 | 7 (stack context filtering) |
| Reviewer Verdict Persistence Phase 1a + 1b | Mar 2026 | Adjacent: quality feedback loop |
| Reviewer Verdict UI | Mar 2026 | Adjacent: quality feedback loop |

Dimensions 1, 2, 4, 6, 7, 8, 9, 10 are fully SHIPPED. Dimension 3 is SHIPPED with a known coarseness limitation. Dimension 5 is a GAP.

---

## Score Change vs Baseline

| Dimension | Pre-Audit | Post-Audit | Delta |
|-----------|-----------|------------|-------|
| 1 — Scope sanity | NOT STARTED | SHIPPED | +1 |
| 2 — Requirement coverage | NOT STARTED | SHIPPED | +1 |
| 3 — Goal-backward framing | NOT STARTED | SHIPPED (coarse) | +0.7 |
| 4 — Dependency correctness | NOT STARTED | SHIPPED | +1 |
| 5 — Key links concreteness | NOT STARTED | GAP | 0 |
| 6 — Verification derivability | NOT STARTED | SHIPPED | +1 |
| 7 — Context compliance | NOT STARTED | SHIPPED | +1 |
| 8 — Nyquist compliance | NOT STARTED | SHIPPED | +1 |
| 9 — Cross-plan data contracts | NOT STARTED | SHIPPED | +1 |
| 10 — Token budget | NOT STARTED | SHIPPED | +1 |

**Pre-audit score: 0/10**
**Post-audit score: 9.7/10** (8 full + dim 3 at ~0.7 + dim 5 missing)

---

## Remaining Gaps

### Gap 1 — Dimension 5: Key Links Concreteness (unimplemented)

No section in `gotcha-checker.md` checks whether plan descriptions of cross-component connections use concrete identifiers versus loose language. Plans that say "wire the component to the existing IPC layer" or "use the standard handler pattern" pass all current checks without specifying which channel, which handler file, or which type. The implementer then makes assumptions that diverge from coder intent, producing reviewer blocks on the boundary review.

The adjacent IPC-completeness check catches a different problem: whether all four IPC quadruple locations are present. Dimension 5 would catch the upstream problem: whether the plan names those locations concretely enough that the coder can write a correct handoff in the first place.

### Gap 2 — Dimension 3: Goal-Backward Framing (coarse implementation)

The current check fires only when all tasks are internal-only. A plan with 9 internal tasks and 1 trivial observable task passes dimension 3 silently. The GSD intent was that each individual must-have task should trace to an observable user outcome. The common case — a plan with mostly infrastructure tasks that lack explicit outcome rationale — is not currently caught.

### Gap 3 — GSD #3 Parallelism (deferred, out of scope for this audit)

The original GSD #3 todo described parallel execution within a wave. The shipped implementation is sequential-within-wave. This was a deliberate scope reduction. Not scored as a gap against the 10 dimensions, but noted for completeness.

---

## Recommended Next Steps (max 3)

### 1. Implement Dimension 5 — Key Links Concreteness Check

Add `## Key links concreteness check` to `gotcha-checker.md`. The check scans each task description for cross-component connection phrases ("connect to", "wire to", "use the existing", "call the handler", "integrate with", "pass to", "send to") and for each such phrase, verifies that a concrete identifier — an IPC channel name, type name, function name, or file path, any of which would appear in backticks or quotes — appears in the same sentence or the immediately preceding/following sentence. If a connection phrase appears without a concrete anchor, emit a WARNING: `**WARNING: Vague key link** — Task N describes a connection without naming a specific channel, type, or file. Add the concrete identifier in backticks so the Coder can produce a non-ambiguous handoff.`

This is a WARNING-only check. It directly addresses the most common source of boundary reviewer REVISE verdicts: handoffs with ambiguous IPC references that the reviewer must infer.

### 2. Strengthen Dimension 3 — Per-Task Goal-Backward Framing

Extend the `## Goal-backward framing check` with a per-task secondary scan. For each task classified as Internal-only, check whether its description contains a rationale phrase: "so that", "enabling", "which allows", "so the user can", "required for", "in order to". If neither a rationale phrase nor a cross-reference (`depends on task N`, `see task N`) to a user-observable task is present, emit a WARNING: `**WARNING: Unanchored internal task** — Task N is internal-only with no stated user outcome or dependency link. Add a "so that <user effect>" clause or a reference to a user-observable task.`

The existing all-or-nothing WARNING should be retained as a fast-path for entirely-internal plans.

### 3. Surface Verdict Pattern Trends in the HEALTH Tab

The board `planned` entry `reviewer-blocker-patterns-deferred-e5a6-c7d8` notes that per-reviewer pattern analysis was deferred pending data accumulation. The HealthPanel already computes per-agent approval rates. The next step is extracting recurring issue patterns: group verdict history by agent, count how many BLOCK verdicts come from each reviewer, and optionally surface the top 3 most-blocked feature names as a "common blockers" list. This closes the feedback loop the original GSD quality model assumed: the system should surface where the pipeline most frequently fails so those patterns can be addressed upstream in the coder agent prompt or GENERAL.md gotchas.

---

## Self-review

This is an audit report, not a code handoff. There are no IPC calls, state mutations, or async calls to verify.

- Async: Not applicable — report content only, no code changes.
- State mutations: Not applicable.
- Edge cases: All evidence claims are sourced from direct file reads. Where a dimension was not found in the checked file, this is stated explicitly (dimension 5). Where an implementation is coarser than the GSD spec, this is noted with a "Partial gap" or "Score: SHIPPED (coarse)" callout.
- IPC return checks: Not applicable.

**Dimension presence cross-check (gotcha-checker.md):**

| Dim | Section heading | Present? |
|-----|----------------|----------|
| 1 | `## Scope sanity check` | YES |
| 2 | `## Requirement coverage check` | YES |
| 3 | `## Goal-backward framing check` | YES |
| 4 | `## Dependency correctness check` | YES |
| 5 | (no dedicated section) | NO — GAP |
| 6 | `## Verification derivability check` | YES |
| 7 | `## Context compliance check` + `## Stack-aware SKILLS.md check` | YES (both) |
| 8 | `## Nyquist compliance check` | YES |
| 9 | `## Cross-plan data contracts check` | YES |
| 10 | `## Token budget check` | YES |

**Reviewer verdict signal cross-check (all five agents):**

- `reviewer.md`: `[reviewer-verdict]` signal in `## Verdict signal` section — CONFIRMED
- `reviewer-logic.md`: `[reviewer-verdict]` signal in `## Verdict signal` section — CONFIRMED
- `reviewer-safety.md`: `[reviewer-verdict]` signal in `## Verdict signal` section — CONFIRMED
- `reviewer-style.md`: `[reviewer-verdict]` signal in `## Verdict signal` section — CONFIRMED
- `reviewer-performance.md`: `[reviewer-verdict]` signal in `## Verdict signal` section — CONFIRMED

**`filterSkillsByStacks` integration cross-check:**

- Function `filterSkillsByStacks` defined in `src/main/shared.ts` — CONFIRMED
- Called from `buildSystemPromptAppend` with `techStackLabels` read from `.pipeline/project.json` — CONFIRMED
- Fallback to full SKILLS.md when stacks array is empty — CONFIRMED

**`append-verdict` / `get-verdicts` handlers cross-check:**

- `append-verdict` handler in `pipeline-data.ts`: path-traversal guard, `fsPromises.appendFile`, server-side timestamp — CONFIRMED
- `get-verdicts` handler in `pipeline-data.ts`: path-traversal guard, `fsPromises.readFile`, malformed-line skip, limit enforcement — CONFIRMED

**HealthPanel.svelte verdict UI cross-check:**

- `loadVerdicts()` called `onMount` and on run status `done`/`error` — CONFIRMED
- Per-agent summaries with approval rate color coding (green/gold/red thresholds) — CONFIRMED
- Recent history list (last 10, newest-first) with blocker/warning counts, feature name truncated to 30 chars, relative timestamp — CONFIRMED
- REVIEWER VERDICTS section with empty-state and loading guard — CONFIRMED
- All CSS colors use CSS custom properties (no raw hex) — CONFIRMED
