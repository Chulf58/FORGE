## Boundary Review: test-author agent and pipeline split

### Violations
- [ ] **AC-1 — Permissions schema missing** — `agents/test-author.md` (planned) must declare a `## Permissions` section with `### Always`/`### Ask First`/`### Never` sub-headings per GENERAL.md:104–130 schema. Plan does not specify how `## Permissions` will be structured; body text mentions "`allowedPaths` in the prompt body" (AC-1, line 129) suggesting permissions are documented informally rather than in a structured GENERAL.md schema block. Must use schema per GENERAL.md:104.
- [ ] **AC-3 — Handoff artefact schema underspecified** — Plan cites "four-section verdict file" and mentions `verify-output.mjs` checking "file mtime only, never parses content" (lines 90–91), but the planned artefact at `docs/context/test-author-handoff.md` is a NEW document type with no published schema. Task 5 (line 185–188) specifies sections (`## Test files written`, `## Failure output`) but does **not** guarantee this schema is enforced in the agent code or persisted in any machine-readable way for validation. AC-3 requires the coder to read a structured artefact; the plan does not document what sections are mandatory, what format failure output takes, or how the coder validates the artefact structure before consuming it.
- [ ] **AC-2 — Phase Execution Loop integration at risk of bypass** — Plan states the split "must integrate with the loop — not bypass it" (line 159) and "the split applies at the coder-dispatch sub-step within each phase, not as a new outer loop" (line 159). However, Task 4 (`skills/implement/SKILL.md`, line 180–183, AC-2/AC-4/AC-5) instructs "test-author dispatch before coder dispatch" and "integrates with the Phase Execution Loop (lines 139-174) without bypassing it" but does **not specify which step of the Phase Execution Loop** the test-author insertion occurs. Reading SKILL.md lines 139–174 shows the loop is:
  - **a. Mark phase running** (call `forge_update_run`)
  - **b. Run Steps 2b–5c scoped to phase** (implementation-architect → coder-scout → coder → test stage → reviewers)
  - **c. Handle phase verdict** (BLOCK/REVISE/APPROVED branching)
  - **d. Reset per-phase state** (clear reviewer outputs)

  The plan does **not clarify** whether test-author runs **inside step b (as a sub-step before coder)** or **outside the loop as a shared pre-phase step**. If test-author runs before the loop (outside it), the red-bar verification fires even if the phase scope changes per invocation — potentially creating stale test files from a prior phase that don't apply to the current phase. This is an **integration ambiguity**, not a violation per se, but Task 4's AC-2 acceptance criterion is incomplete.

### Verified
- [x] **Agent-roles.json scope** — AC-7 specifies `allowedPaths` covering discovery patterns: `hooks/*-test.js`, `mcp/*-test.mjs`, `scripts/*-test.mjs`, `docs/context/test-author-handoff.md`. These match the patterns defined in `scripts/run-tests.mjs` discovery (PLAN lines 155: "lines 23-26"). Current `.pipeline/agent-roles.json` (read) has 31 agent entries; test-author is not yet registered (expected pre-implementation). Addition of four paths is straightforward glob matching.
- [x] **Wave 1 red-bar design** — AC-6 specifies failing tests in `scripts/test-author-wave.test.mjs` asserting (a) test-author dispatch before coder, (b) red-phase abort on exit 0, (c) coder receives handoff path not transcript (line 168). Plan requires `node --test scripts/test-author-wave.test.mjs` to exit non-zero pre-implementation. This is sound TDD structuring per GENERAL.md:161–173 (TDD discipline for enforcement infrastructure).
- [x] **Wave 3 regression scope** — AC-11 equivalent for test-author feature (Task 6, line 192): full regression runs `scripts/test-author-wave.test.mjs` + existing TDD-guard, classifier, and reviewer-dispatch tests. No test deletion or skip markers permitted. Plan correctly chains the wave: Wave 1 (failing tests) → Wave 2 (implementation) → Wave 3 (regression green).
- [x] **Handoff artefact consumed unidirectionally** — AC-3 specifies coder reads `docs/context/test-author-handoff.md` (not the test-author session). SKILL.md Task 4 (line 180–183) prepends `[test-author-handoff: <path>]` signal to coder prompt and "instructs coder to read only that file, not the test-author session." This isolates test-author reasoning from the coder context (per research §4.2 subagent isolation), which is the goal. Signal pattern `[test-author-handoff: <path>]` is analogous to existing patterns: `[phase-scope: <label>]` (SKILL.md line 147), `[revision-mode: N]` (SKILL.md line 278), `[failed-criteria: ...]` (SKILL.md line 278). **No documented contract for this signal type exists** — but the pattern mirrors existing signals that also lack a central registry. This is a precedent consistency issue, not a blocking architectural problem.
- [x] **Red-phase abort mechanism** — AC-4 specifies aborting if test exits 0 without source changes. SKILL.md Task 4 (line 180–183) describes "red-phase check: run `node --test <test-file-path>` on new test files, abort with warning if exit 0". This is implementable inline in the skill as a conditional branch. The abort message "identifies which test file passed without implementation" is noted; no new agent/hook is required.
- [x] **Green-phase verification** — AC-5: after coder runs, "same test command must exit 0 for the new test files; if exit non-zero, the coder revision loop (max 2 passes, per existing SKILL.md Step 5b) applies." Current SKILL.md Step 2b (lines 202–227) implements test-pass verification already; the plan reuses this mechanism. The test stage is **already between coder and completeness-checker** (line 202), so green-phase check is automatic.
- [x] **Out-of-scope decisions are sound** — Plan excludes `skills/debug/SKILL.md` and `skills/refactor/SKILL.md` (line 142) because those pipelines start from existing failure state. `forge-config.default.json` routing (line 143) is deferred as a follow-up. Both are acceptable scope boundaries for this feature.

### Per-criterion verdicts

- **AC-1: NOT_MET** — `agents/test-author.md` frontmatter and Permissions section structure not specified. Must declare YAML frontmatter per GENERAL.md:3–5 and must include `## Permissions` with `### Always`/`### Ask First`/`### Never` per GENERAL.md:104–130. Current plan body mentions "valid YAML frontmatter (`name: test-author`, `model: claude-haiku-4-5-20251001`, `tools: [Read, Write, Glob, Grep, Bash]`)" (line 174) and "`## Permissions` with `### Always`/`### Ask First`/`### Never` per GENERAL.md schema" (line 174), which is correct but incomplete:
  - Frontmatter must declare `description`, `model`, `tools` per GENERAL.md:3–5. Plan declares only the fields, not whether task `2` will **enforce all required fields** (no optional fields like `maxTurns` or `skills`).
  - `## Permissions` sub-headings must follow the **exact schema structure** from GENERAL.md:105–126 (three required sub-headings in order, with specific bullet structures). Plan says "per GENERAL.md schema" but does not cite the exact lines or enforce schema validation.

  **Recommendation:** Coder must ensure frontmatter is complete (name, description, model, tools at minimum) and must instantiate the three `## Permissions` sub-headings with substantive content (at least one bullet per sub-heading).

- **AC-2: NOT_MET — Phase Execution Loop integration point ambiguous** — Plan states "the split must nest inside that loop cleanly" (line 159) but **does not specify the execution point**. Task 4 (AC-2) says test-author dispatch is "before coder dispatch" (line 181) and "integrates with the Phase Execution Loop (lines 139-174) without bypassing it" (line 182), but the Phase Execution Loop's step structure has no explicit "test-author step". Is it:
  1. **Sub-step of 2b (scoping check)?** — No, scoping produces a brief.
  2. **Sub-step of 3.1 (coder-scout)?** — No, scout is optional and produces JSON.
  3. **New micro-step between 2b and 3.1?** — Possible but requires updating the loop structure.
  4. **Part of 3.2 (coder)?** — No, test-author is separate from coder.
  5. **New step 2b-alt or 3.0?** — Requires clarification in SKILL.md revision.

  **Current SKILL.md (Phase Execution Loop) does NOT have a named test-author invocation.** Implementer must explicitly add a test-author dispatch sub-step with clear handling of phase-scope (i.e., which test files the test-author should write for this phase — only the current phase's tasks, not all phases).

  **Recommendation:** Task 4 must specify that test-author runs as **step 3.0 (before coder-scout)** with scope limited to the **current phase's task lines only**, receiving `[phase-scope: <label>]` like the coder does (SKILL.md line 147).

- **AC-3: NOT_MET — Handoff artefact schema not documented for consumer validation** — Plan specifies `docs/context/test-author-handoff.md` will contain two sections: `## Test files written` (absolute paths) and `## Failure output` (raw `node --test` exit output) (lines 186–187). However:
  1. **No schema validation mechanism** — Plan does not state whether the artefact has a validation step or schema file. Compare with `docs/context/handoff.md` (coder handoff), which is consumed by reviewers who parse its sections via regex (reviewer agents read the file directly and trust its format). Does test-author-handoff have a TXT/JSON schema, or is it purely Markdown parsed by eye?
  2. **No enforcement of "no reasoning"** — Plan says "no `## Reasoning` or design narrative sections" (line 187), but does not say how the coder enforces this when reading the handoff. Does the agent read a plain-text file, or is there a format check?
  3. **No error-recovery path** — What if test-author-handoff.md is missing, truncated, or malformed? Plan does not specify whether the coder has a fallback or abort condition.

  **Recommendation:** Task 5 must produce a **schema definition** for test-author-handoff.md (e.g., a JSON template, a sample, or a formal structure) that the coder can validate. Alternatively, test-author must emit a JSON artefact at a fixed path (e.g., `.pipeline/context/test-author-output.json`) with a machine-readable schema, and the coder reads that instead of parsing Markdown.

- **AC-4: SKIPPED** — Red-phase verification is a skill-level implementation detail (not a boundary contract). The plan correctly describes the mechanism (run test, abort if exit 0) and the expected output ("identifies which test file passed without implementation"). No architectural boundary violation.

- **AC-5: SKIPPED** — Green-phase verification reuses existing test-stage logic (SKILL.md Step 2b). No new boundary or contract.

- **AC-6: MET** — Task 1 `scripts/test-author-wave.test.mjs` is specified with clear passing/failing criterion (AC-6): "exits non-zero; test cases assert (a) wave-split step list includes test-author before coder, (b) red-phase abort fires, (c) coder receives handoff path not transcript." These are testable conditions. No boundary issues.

- **AC-7: MET** — `.pipeline/agent-roles.json` entry for test-author with `allowedPaths` covering all test-file discovery patterns + handoff artefact path is specified (line 178). No boundary violation.

- **AC-1 (frontmatter)**: MET partially — plan specifies fields correctly, but schema enforcement is underspecified (see AC-1 full analysis above).

### Verdict

REVISE — 3 minor issues requiring clarification before implementation. No **blockers** (architecture violations or broken contracts), but coder must:

1. **AC-1:** Ensure `agents/test-author.md` frontmatter includes all required fields (`name`, `description`, `model`, `tools`) and instantiate `## Permissions` with three sub-headings (`### Always`, `### Ask First`, `### Never`) per GENERAL.md:105–126 schema. This is standard for all agents; plan text is correct but could be more explicit.

2. **AC-2:** Add explicit test-author dispatch step to the Phase Execution Loop in `skills/implement/SKILL.md` **within step 3.0** (new micro-step between steps 2b and 3.1), scoped to the current phase's task lines only. Signal the coder with `[phase-scope: <label>]` just like the scoped coder receives (SKILL.md line 147).

3. **AC-3:** Define a schema or contract for `docs/context/test-author-handoff.md` that the coder can validate. Either emit a fixed-format JSON artefact (recommended) or specify the Markdown structure as a formal template with required sections and validation rules.

All three issues are resolvable during implementation without rearchitecting the feature. The wave split design, TDD structure, and handoff isolation pattern are sound.

