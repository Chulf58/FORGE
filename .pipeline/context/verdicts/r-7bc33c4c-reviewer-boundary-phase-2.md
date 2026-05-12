## Boundary Review: Plan-stage REVISE retry loop — Phase 2

### Violations
- [x] None — all boundary checks pass

### Verified
- [x] **Architecture boundaries** — Step 6 (new REVISE-retry loop) mirrors implement-stage Step 5b/5c with correct layer separation. Loop logic stays within plan-skill namespace; no cross-boundary violations.
- [x] **Wiring and signal contracts** — `[revision-mode: M]` prefix documented in new `## Revision mode` section; `[failed-criteria: <AC-IDs>]` signal reused from implement-stage pattern; `revisingUnresolved: true` gate marker is additive (optional boolean field compatible with existing gate-pending.json consumers).
- [x] **Step numbering and structure** — Original Step 6 (Gate #1) correctly renumbered to Step 7 after insertion of new Step 6 (REVISE-retry loop). Diff shows correct ordering: verdict processing → gate write → user presentation.
- [x] **Verdict processing logic** — Step 6 clearly specifies: BLOCK → fail/exit, REVISE+M<2 → increment and re-invoke planner, REVISE+M>=2 → gate with `revisingUnresolved: true`, APPROVED → proceed clean. Matches symmetry checklist.
- [x] **Plan-stage divergence** — Key divergence from implement-stage (M>=2 opens gate with marker vs. failing run) is explicit in SKILL.md line 144 and in gate1 write variants (lines 166-168). Conductor can fix PLAN.md inline before approval — fallback path preserved.
- [x] **Reviewer re-dispatch** — Step 6 correctly specifies no re-classification (same reviewer set iterates). Stale reviewer output cleared before re-dispatch; same `--plan=<worktreePath>/docs/PLAN.md --stage=plan` invocation per line 159.
- [x] **Mtime checking** — `verify-output.mjs` tool invoked per reviewer with `--since=<reviewerStartedAtMs>` timestamp; no-verdict treated as REVISE-unresolved (lines 146-150). Aligns with implement-stage pattern.
- [x] **Gate file structure** — Two variants documented: clean gate1 (line 166, no marker) and unresolved gate1 (line 167, `revisingUnresolved: true`). Both include proper `gateState` updates to run object.
- [x] **Planner revision mode section** — `## Revision mode` (lines 293-312) covers all four requirements: (a) read signal, (b) read feedback from reviewer-output dir, (c) edit PLAN.md surgically (Resolution sections, direct AC edits, scope clarification), (d) preserve completed tasks/structure. Section correctly positioned before `## Output signal`.
- [x] **Revision mode edit patterns** — Three patterns specified: Resolution block, Direct AC edit, Out-of-scope clarification. Guidance on final pass (M=2) unresolved concerns clear (acknowledge in Resolution, surface via gate marker, don't fabricate).
- [x] **[todo] signal discipline** — Planner instructed to emit `[todo]` only for tasks ADDED in revision pass (line 312), not re-emit existing tasks. This is clarification of usage, not a format change to `[todo]` signal itself.

### Per-criterion verdicts

- `AC-4: MET` — `skills/plan/SKILL.md` Step 6 (lines 142-163) implements the REVISE-retry loop: tracks M starting 0, mtime-checks verdict files, processes verdicts with M<2 re-invoke / M>=2 gate-with-marker / APPROVED-proceed branching, handles BLOCK with early exit. Mirrors implement-stage Step 5b/5c with correct divergence at M>=2.
- `AC-5: MET` — `agents/planner.md` `## Revision mode` section (lines 293-312) appears before `## Output signal` (line 314) and specifies: read `[revision-mode: M]` signal, read REVISE feedback from `<worktreePath>/.pipeline/context/reviewer-output/`, edit PLAN.md surgically using Resolution blocks or direct AC edits, preserve completed tasks and overall structure, acknowledge M=2 unresolved items via gate marker without fabricating resolution.

### Findings assessment

**FIND-1: signal-format-change on `agents/planner.md:20`, snippet `[todo]`**

This is a **FALSE POSITIVE — DISMISSED**. The finding appears to reference an old line number that has shifted due to the insertion of the `## Revision mode` section. Investigation shows:

1. The `[todo]` signal is documented in `docs/SIGNAL-PROTOCOL.md` lines 26-30 as an existing, stable signal with format `[todo] <task text>`.
2. The new `## Revision mode` section (lines 293-312) does NOT introduce a new signal format — it clarifies WHEN to emit `[todo]` lines (only for tasks added in revision pass, not re-emitted existing tasks).
3. The existing `## Output signal` section (lines 314-329) continues to show the same `[todo]` format: `[todo] <task 1 text>` / `[todo] <task 2 text>`.
4. No signal format change is present in the diff — the usage discipline is documented in `## Revision mode` line 312 as clarification of existing behavior.

Conclusion: The `[todo]` signal format remains unchanged. The finding is dismissed as a false positive caused by line-number offset drift.

### Verdict
APPROVED — all boundary checks pass. Phase 2 adds the plan-stage REVISE-retry loop to SKILL.md with correct step numbering, verdict processing, mtime-checking, and gate divergence from implement-stage. The planner.md `## Revision mode` section provides complete semantics for revision-mode invocations with surgical editing guidance and proper M=2 unresolved handling via gate marker. No wiring gaps, no signal-format changes, no architecture violations. Ready for Phase 3 regression and smoke testing.
