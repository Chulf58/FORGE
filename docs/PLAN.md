## Active Plan

<!-- Note: a stale "clear gate-pending.json" Feature 3 leftover from r-451ff6ed/r-1d2d7ebe inherited via main's PLAN.md (lifecycle-prune bug 96b5e0ce). Removed here to prevent implementer-scoping confusion with Slice 1. -->

### Feature: Structured findings contract — Slice 1 (folds TODOs 4623e1d2 + 8eded49c)

SHIPPED 2026-05-12 (r-ded76e32) — reviewers APPROVED at gate2

Summary: Upgrade `lean-risk-classify.mjs` triggered output from flat strings to structured finding objects, write `findings.json`, and inject findings into reviewer prompts so reviewers emit per-finding `FIND-<id>:` verdicts alongside existing AC verdicts.

**Scope summary (Slice 1 contract):**
`lean-risk-classify.mjs` currently pushes `"rule:snippet"` strings into `triggered`. This slice replaces those with `{rule, file, line, snippet, suggestedCheck}` objects, preserving the legacy string array as `triggeredRulesLegacy` for back-compat. `reviewer-dispatch.mjs` writes the structured array to `<wt>/docs/context/findings.json` in addition to the existing `lean-gate.json`. Four reviewer agents (`reviewer-safety`, `reviewer-boundary`, `reviewer-logic`, `reviewer-performance`) read `findings.json` when present, scope review to domain-relevant findings, and emit `FIND-<id>: CONFIRMED / DISMISSED / NEEDS-INVESTIGATION` lines alongside existing per-AC verdict lines. `skills/implement/SKILL.md` injects a `[findings: <path>]` prefix into reviewer prompts. Reviewer overall verdict shape (BLOCK/REVISE/APPROVED) is unchanged.

**Out of scope:**
- AST detection upgrade (Slice 3 — depends on findings contract being stable first)
- Per-finding verdict aggregation (Slice 2 — depends on this slice)
- `agents/reviewer-tests.md` integration (separate TDD chain per audit line 228)
- `scripts/phase-verify.mjs` lint-ratchet / LoC-delta checks (Slice 4 — independent)

**Files to touch (with audit-cited line ranges):**
1. `scripts/lean-risk-classify.mjs` — lines 194–211 (handoff classifier `triggered.push`) and lines 304–323 (diff classifier `triggered.push`)
2. `scripts/reviewer-dispatch.mjs` — lines 166–173 (rule iteration reading `triggeredRules`) and the result write at ~line 284 (via SKILL.md reference)
3. `agents/reviewer-safety.md` — verdict format section (~lines 104–133 per audit)
4. `agents/reviewer-boundary.md` — verdict format section (same structure)
5. `agents/reviewer-logic.md` — verdict format section (same structure)
6. `agents/reviewer-performance.md` — verdict format section (same structure)
7. `skills/implement/SKILL.md` — line 292 area (reviewer prompt prefix injection, mirror of `[reviewer-output-dir: …]`)

#### Phase 1 — Failing tests (TDD wave 1 — red bar)

- [x] 1. Add failing test for structured finding object shape (`scripts/findings-contract-test.mjs`) (wave: 1)
  Intent: Establish a red bar that passes only once the classifier emits `{rule, file, line, snippet, suggestedCheck}` objects rather than `"rule:snippet"` strings, preventing silent shape regression.
  Verify: AC-1: `node scripts/findings-contract-test.mjs` exits non-zero before any classifier change; the test asserts that each element of `triggeredRules` is an object with all five required keys, not a string; `triggeredRulesLegacy` is an array of strings matching the old format.

- [x] 2. Add failing test for `findings.json` write path (`scripts/findings-contract-test.mjs`) (wave: 1)
  Intent: Lock down the new file artifact produced by the dispatch script so absence or wrong schema is caught deterministically before reviewers are spawned.
  Verify: AC-2: A test case in `scripts/findings-contract-test.mjs` calls the dispatch path with a known classification result and asserts that `docs/context/findings.json` is written and contains a JSON array whose elements each have `rule`, `file`, `line`, `snippet`, and `suggestedCheck` keys; exits non-zero before dispatch script change.

- [x] 3. Add failing test for reviewer prompt injection contract (`scripts/findings-contract-test.mjs`) (wave: 1)
  Intent: Verify that the `[findings: <path>]` prefix line is prepended to reviewer prompts when `findings.json` exists, so the injection is mechanically confirmed rather than manually audited.
  Verify: AC-3: A test case asserts the assembled reviewer prompt string begins with `[findings: ` and the path resolves to a readable file; exits non-zero before `skills/implement/SKILL.md` is updated.

#### Phase 2 — Implementation (TDD wave 2 — green bar)

- [x] 4. Upgrade classifier `triggered` output to structured objects (`scripts/lean-risk-classify.mjs`) (wave: 2)
  Depends: 1
  Intent: Replace `"rule:snippet"` string pushes with `{rule, file, line, snippet, suggestedCheck}` objects in both the handoff and diff classifiers, and add `triggeredRulesLegacy` for back-compat.
  Verify: AC-4: The test from task 1 exits 0; `triggeredRules` elements are objects with all five keys; `triggeredRulesLegacy` is an array of strings in the original `"rule:snippet"` format; `lean-risk-classify.mjs` lines 194–211 and 304–323 are updated. See Resolution items 1, 2, 3, 4 below for `line` nullability, dual-location synchronization, finding-ID assignment, and `suggestedCheck` field source.

- [x] 5. Write `findings.json` from dispatch script (`scripts/reviewer-dispatch.mjs`) (wave: 2)
  Depends: 1, 2, 4
  Intent: Make structured findings available to reviewer agents as a side-car file alongside `lean-gate.json`, without changing the existing `lean-gate.json` write.
  Verify: AC-5: The test from task 2 exits 0; `<wt>/docs/context/findings.json` is written when `triggeredRules` is non-empty; the file contains a JSON array with the same objects as `triggeredRules`; `lean-gate.json` write is unchanged. See Resolution item 5 below for worktree-path validation.

- [x] 6. Inject `[findings: <path>]` prefix into reviewer prompts (`skills/implement/SKILL.md`) (wave: 2)
  Depends: 2, 3, 5
  Intent: Pass the structured findings path to each reviewer so reviewers can scope their analysis to the pre-identified risk surface rather than re-deriving it from raw diff text.
  Verify: AC-6: The test from task 3 exits 0; `skills/implement/SKILL.md` contains a `[findings: <path>]` injection step immediately adjacent to the existing `[reviewer-output-dir: …]` step at line 292; the path resolves to `<worktreePath>/docs/context/findings.json`.

- [x] 7. Update four reviewer agents to read `findings.json` and emit `FIND-<id>:` lines (`agents/reviewer-safety.md`, `agents/reviewer-boundary.md`, `agents/reviewer-logic.md`, `agents/reviewer-performance.md`) (wave: 2)
  Depends: 5, 6
  Intent: Close the loop so reviewers consume pre-identified findings and emit structured verdicts per finding, eliminating re-derivation of the risk surface from raw diff text.
  Verify: AC-7: Each of the four reviewer agents contains a section instructing them to (a) read `docs/context/findings.json` when it exists, (b) scope review to findings in their declared domain, and (c) emit one `FIND-<id>: CONFIRMED / DISMISSED / NEEDS-INVESTIGATION` line per relevant finding; overall BLOCK/REVISE/APPROVED verdict shape is unchanged.

#### Phase 3 — Smoke test and regression (TDD wave N)

- [x] 8. Smoke test: classifier emits N findings, reviewer emits N `FIND-<id>:` lines (`scripts/findings-contract-test.mjs`) (wave: 3)
  Depends: 4, 5, 6, 7
  Intent: Validate the end-to-end contract from classifier output to reviewer verdict line so a shape mismatch between the two layers is caught before the slice ships.
  Verify: AC-8: A smoke-test scenario in `scripts/findings-contract-test.mjs` runs the classifier against a synthetic handoff that triggers exactly 3 risk patterns, writes `findings.json`, and asserts that a simulated reviewer output contains exactly 3 `FIND-<id>:` lines (one CONFIRMED, one DISMISSED, one NEEDS-INVESTIGATION); test exits 0. See Resolution item 3 below for order-independent assertion.

- [x] 9. Full regression suite green after Slice 1 changes (`scripts/run-tests.mjs`) (wave: 3)
  Depends: 4, 5, 6, 7, 8
  Intent: Confirm that the shape change in `lean-risk-classify.mjs` and the new dispatch write do not break any existing test that consumes `triggeredRules` as strings.
  Verify: AC-9: `node scripts/run-tests.mjs` exits 0 with no previously-passing tests now failing; `scripts/findings-contract-test.mjs` exits 0; `triggeredRulesLegacy` presence ensures any consumer reading the old string format still gets a string array.

### Research needed

None — audit r-63c937e9 already covers the design decisions; cite it from `docs/RESEARCH/deterministic-pre-review-cluster.md` §Slice 1.

### Approach summary
- Decision: Extend classifier output to structured objects + write `findings.json` side-car + inject into reviewer prompts + add `FIND-<id>:` verdict lines in reviewers. TDD-structured in three waves. Audit r-63c937e9 establishes all design decisions.
- Trade-off: `triggeredRulesLegacy` adds a redundant string array that must be removed once all consumers migrate (Slice 2 dependency cleanup); accepted to avoid a big-bang consumer migration.
- Uncertainty: The `line` field in `{rule, file, line, snippet, suggestedCheck}` requires the classifier to track character offset → line number — confirm the regex `exec` loop provides enough context to compute this or fall back to `null` (see Resolution item 1).

### Resolution 2026-05-12 (Slice 1 reviewer REVISE response)

Addresses spec-precision items from r-ded76e32 gate1 reviewers (reviewer-logic REVISE, reviewer-safety REVISE). All 5 items are clarifications, not blockers (per reviewers' own framing).

**1. `line` field nullability (reviewer-logic)** — `line` is REQUIRED but accepts `null` when the classifier cannot compute a line number from the regex match. Object shape: `{rule: string, file: string, line: number | null, snippet: string, suggestedCheck: string}`. AC-4 test must assert that when present, `line` is either a positive integer or `null`. Computation: in the handoff classifier, the `exec` loop yields a character offset within `addedCode`; convert to line number via `addedCode.slice(0, m.index).split('\n').length`. Falls back to `null` only if the offset is unavailable (defensive guard, not expected in practice).

**2. Dual-location synchronization (reviewer-logic)** — Both `triggered.push(…)` sites at `lean-risk-classify.mjs:194-211` (handoff classifier) and `:304-323` (diff classifier) MUST emit objects with identical key sets. AC-4 test must call both code paths and assert shape equivalence — same five keys present, same types, same null/non-null treatment for `line`. Implementation should extract a shared `pushFinding(triggered, {rule, file, line, snippet, suggestedCheck})` helper if duplication grows, but the AC enforces shape regardless of code factoring.

**3. Smoke test finding-ID determinism (reviewer-logic)** — Finding IDs are assigned by the classifier as `FIND-<N>` where `N` is the sequential 1-based index in the order findings are pushed to `triggered`. The smoke test (AC-8) is ORDER-INDEPENDENT: it parses the simulated reviewer output, collects the `FIND-<N>:` lines into a set, and asserts the set equals `{FIND-1, FIND-2, FIND-3}` with the expected total of 3 (one CONFIRMED, one DISMISSED, one NEEDS-INVESTIGATION). The test does NOT assert which finding gets which verdict.

**4. `suggestedCheck` field source + sanitization (reviewer-safety)** — `suggestedCheck` is a STATIC string defined alongside each entry in `RISK_CONTENT_PATTERNS` and `RISK_DIFF_PATTERNS` in `lean-risk-classify.mjs`. NOT derived from match content. No sanitization required since the field is editor-authored constant text controlled by the pattern table. AC-4 test asserts: (a) every pattern entry in both tables has a non-empty static `suggestedCheck` string defined; (b) the field on each emitted finding object equals the matching pattern's static `suggestedCheck` value. No string interpolation of match content into this field is permitted.

**5. Worktree path validation (reviewer-safety)** — `findings.json` write target MUST be inside the worktree. AC-5 implementation requires: (a) validate `<worktreePath>` exists and is a directory via `fs.statSync(...).isDirectory()` before write; (b) compute the resolved target as `path.join(worktreePath, 'docs/context/findings.json')`; (c) call `path.resolve(target)` and assert the resolved path starts with `path.resolve(worktreePath) + path.sep` (rejects path-traversal attempts). On any validation failure: log `[reviewer-dispatch] findings.json write rejected: <reason>` to stderr and skip the write (fail-open — do NOT throw, do NOT crash the dispatch script). AC-5 test asserts the write path is rejected when `worktreePath` is non-directory OR when the resolved target escapes the worktree root.

---

### Feature: Plan-stage REVISE retry loop (closes TODO c41f1504)

Summary: Add a REVISE-retry loop to `skills/plan/SKILL.md` mirroring the implement-stage loop so planner iterates on reviewer feedback before gate1 fires.

**Acceptance criteria (contractual — preserved verbatim from TODO):**
- AC-1: `skills/plan/SKILL.md` has a Step (mirror implement-stage Step 5c at SKILL.md:250-264) that handles REVISE-retry on plan-stage reviewer output.
- AC-2: Worker re-invokes planner with `[revision-mode: M]` prefix + REVISE feedback. Max M=2.
- AC-3: Reviewer dispatch is NOT re-run on revision passes (same reviewer set iterates).
- AC-4: After 2 unresolved REVISE passes, gate1 still opens but with a clear marker that human review is required.
- AC-5: BLOCK behavior unchanged — exits the retry loop, conductor decides.
- AC-6: TDD-structured: new test in `skills/plan` or new helper exercises the retry loop in isolation. Red bar before implementation.
- AC-7: r-5caed835-style scenario (3 REVISE concerns, all spec-precision, all inline-fixable) reaches APPROVED on retry M=1 in a smoke test.

**Files to modify:**
- `skills/plan/SKILL.md` — add REVISE-retry step after the reviewer dispatch step (Step 5/6 area)
- `agents/planner.md` — add `## Revision mode` section explaining `[revision-mode: M]` semantics

**Files to create:**
- `scripts/plan-revise-loop-test.mjs` — isolated test exercising the retry loop logic

**Out of scope:**
- BLOCK auto-retry (separate TODO 1db279a1)
- bba4a9d9 (stacked PLAN.md cleanup) — orthogonal
- Reviewer-side retry — reviewers are already idempotent

**Symmetry checklist (implement-stage → plan-stage mapping):**

| Implement-stage concept | Plan-stage equivalent |
|---|---|
| Revision counter `N` (starts 0, max 2) | Revision counter `M` (starts 0, max 2) |
| Verdict files in `reviewer-output/` | Same directory — `<worktreePath>/.pipeline/context/reviewer-output/` |
| `[revision-mode: N]` prefix to coder | `[revision-mode: M]` prefix to planner |
| `[failed-criteria: AC-X, AC-Y]` from `AC-<N>: NOT_MET` lines | Same signal — `AC-<N>: NOT_MET` lines from reviewer output |
| REVISE + `N < 2` → re-invoke coder | REVISE + `M < 2` → re-invoke planner |
| REVISE + `N >= 2` → `status: "failed"` | REVISE + `M >= 2` → gate1 opens with `[revise-unresolved]` marker |
| BLOCK → `status: "failed"`, no gate | BLOCK → existing behavior, no gate (unchanged) |
| Reviewer dispatch NOT re-run on revision | Same — same reviewer set iterates, no re-classification |
| Revised coder re-saves git diff before re-review | Planner re-writes PLAN.md before re-review |
| mtime check on each verdict file (`verify-output.mjs`) | Same mtime check on each verdict file |

**Key divergence from implement-stage:** when `M >= 2` and REVISE is still unresolved, gate1 OPENS (with marker) rather than failing the run, because the human conductor can still fix PLAN.md inline before approving gate1. This preserves the existing fallback path while eliminating the common case of manual toil.

#### Phase 1 — Failing tests (TDD red bar)

- [ ] 1. Add failing test for REVISE-retry loop logic (`scripts/plan-revise-loop-test.mjs`) (wave: 1)
  Intent: Establish a red bar that gates implementation — the test must fail before any SKILL.md change, confirming the loop does not yet exist.
  Verify: AC-1: `node scripts/plan-revise-loop-test.mjs` exits non-zero before any skill change; the test asserts that a simulated plan-stage worker with a REVISE verdict re-invokes the planner with `[revision-mode: 1]` on the first pass and `[revision-mode: 2]` on the second pass, never exceeding M=2.

- [ ] 2. Add failing smoke test for M=1 APPROVED scenario (`scripts/plan-revise-loop-test.mjs`) (wave: 1)
  Intent: Lock down the happy path — one REVISE followed by APPROVED resolves cleanly without opening a `[revise-unresolved]` gate.
  Verify: AC-2: A test case in `scripts/plan-revise-loop-test.mjs` simulates a reviewer emitting REVISE on pass 0, then APPROVED on pass 1 (M=1), and asserts gate1 opens with `status: "pending"` and no `[revise-unresolved]` marker; exits non-zero before implementation.

- [ ] 3. Add failing smoke test for M=2 unresolved gate marker (`scripts/plan-revise-loop-test.mjs`) (wave: 1)
  Intent: Confirm that two failed revision passes produce a visible `[revise-unresolved]` marker in gate1 rather than a silent failure, so the conductor knows manual fix is required.
  Verify: AC-3: A test case asserts that when both revision passes still emit REVISE, the gate1 JSON written to disk contains a `revisingUnresolved: true` field and the gate status is `"pending"` not `"failed"`; exits non-zero before implementation.

#### Phase 2 — Implementation (TDD green bar)

- [ ] 4. Add REVISE-retry step to plan-stage skill (`skills/plan/SKILL.md`) (wave: 2)
  Depends: 1, 2, 3
  Intent: Mirror the implement-stage Step 5b/5c loop so the worker auto-retries the planner on REVISE before writing gate1, eliminating recurring conductor toil.
  Verify: AC-4: `skills/plan/SKILL.md` contains a numbered step after reviewer dispatch that (a) tracks counter M starting at 0, (b) on REVISE with M<2 re-invokes planner with `[revision-mode: M]` and REVISE context, (c) on REVISE with M>=2 writes gate1 with `revisingUnresolved: true`, (d) on BLOCK exits without writing gate1; `node scripts/plan-revise-loop-test.mjs` exits 0.

- [ ] 5. Add `## Revision mode` section to planner agent (`agents/planner.md`) (wave: 2)
  Depends: 4
  Intent: Teach the planner how to behave when invoked with `[revision-mode: M]` so it edits PLAN.md inline to address REVISE concerns rather than rewriting from scratch.
  Verify: AC-5: `agents/planner.md` contains a `## Revision mode` section that specifies (a) read the `[revision-mode: M]` signal, (b) read the REVISE feedback from the reviewer output dir, (c) edit PLAN.md to address each concern using Resolution sections or direct AC edits, (d) do not rewrite the full plan; the section appears before `## Output signal`.

#### Phase 3 — Regression and smoke verification

- [ ] 6. Smoke test: r-5caed835 scenario reaches APPROVED at M=1 (`scripts/plan-revise-loop-test.mjs`) (wave: 3)
  Depends: 4, 5
  Intent: Validate the end-to-end contract against the scenario that motivated this feature — three spec-precision REVISE concerns resolved in one planner revision pass.
  Verify: AC-6: A test case in `scripts/plan-revise-loop-test.mjs` injects three REVISE concerns (all spec-precision, all inline-fixable), runs one planner revision pass, simulates a reviewer emitting APPROVED, and asserts gate1 opens clean without `revisingUnresolved`; test exits 0.

- [ ] 7. Full regression suite green after plan-stage loop changes (`scripts/run-tests.mjs`) (wave: 3)
  Depends: 4, 5, 6
  Intent: Confirm the new skill step and planner section do not break existing plan-pipeline behavior or any other test that reads `skills/plan/SKILL.md`.
  Verify: AC-7: `node scripts/run-tests.mjs` exits 0 with no previously-passing tests now failing; `node scripts/plan-revise-loop-test.mjs` exits 0 with all three scenario cases passing.

### Research needed

None — the implement-stage loop in `skills/implement/SKILL.md:250-264` and `mcp/forge-worker.mjs` provide the complete pattern to mirror; the divergence (gate1 opens with marker vs. run fails) is fully specified in the TODO.

### Approach summary
- Decision: Mirror the implement-stage 2-iteration REVISE loop at skill level (`skills/plan/SKILL.md`) with one deliberate divergence — M>=2 opens gate1 with `revisingUnresolved: true` rather than failing the run, preserving the human fallback path.
- Trade-off: Gate1 may open in a partially-unresolved state, requiring conductor attention — accepted because the prior state (always manual) was strictly worse.
- Uncertainty: Whether `scripts/run-tests.mjs` already covers `skills/plan/SKILL.md` content or only script files; if not, the regression task (7) verifies only the new test file.

### Risk and rollback

**Infinite loop risk:** If M is not incremented before re-invoking the planner, the loop runs forever. Mitigation: test task 1 explicitly asserts M increments on each pass and the loop terminates after M=2.

**Divergence drift:** The implement-stage loop may evolve after this feature ships, causing the plan-stage loop to diverge silently. Mitigation: the symmetry checklist in this plan is the canonical reference; any future implement-stage change should note the corresponding plan-stage update in the TODO.

**gate1 marker ignored:** If the conductor does not check `revisingUnresolved` in gate1, the unresolved-REVISE case degrades silently to the current state (manual fix required but not surfaced). Mitigation: the `revisingUnresolved: true` field is added to `gate-pending.json` which the observer dashboard already renders.

**Rollback:** The changes are additive — adding a new step to SKILL.md and a new section to planner.md. Rolling back requires removing those additions. No schema changes to existing data files; `gate-pending.json` gains one optional boolean field, which existing consumers ignore.
