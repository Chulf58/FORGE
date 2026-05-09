## Active Plan

(Stale prior feature blocks removed by conductor at gate1 of r-29e0e2c5. Already shipped today: TDD Guard Hook via merge 5072aad2; reviewer-tests agent via merge ab3b2213; test-author agent + pipeline split via r-29e0e2c5. No active plan.)

### Feature: test-author agent and pipeline split

Summary: Add a `test-author` agent and split the implement pipeline into test-author (red) → coder (green) waves, closing board TODO `2e73852d`.

## Context

Board TODO `2e73852d` — research §3.2 (Red+Green collapse), §3.3 (tests that pass before implementation), §4.2 (subagent isolation), §6.2 (FORGE-shaped pipeline-staged pattern), §9.2 (test-author on Haiku). Sibling work: `reviewer-tests` agent (TODO `48bddb1b`) ships diff-aware test-weakening detection; `tdd-guard` hook (TODO `e0450cf5`) is already DONE. This feature adds the upstream structural split: a separate agent authors the failing tests before the coder sees the feature.

The single-agent coder context failure: even with TDD-structured planning, the coder sees the plan, mentally drafts the implementation, then writes tests the mental implementation will satisfy (§3.3). Subagent isolation (§4.2) eliminates this by having a different agent — with no memory of the coder conversation — write the implementation. The coder receives only test file paths + failure log, not the test-author's reasoning trace.

## Acceptance criteria

- AC-1: `agents/test-author.md` exists with valid YAML frontmatter (`name`, `description`, `model`, `tools`) and a `## Permissions` section with `### Always`/`### Ask First`/`### Never` per GENERAL.md schema. `allowedPaths` in the prompt body restricts writes to test-file patterns only (`*-test.js`, `*-test.mjs`, `scripts/*-test.mjs`, `hooks/*-test.js`).
- AC-2: `skills/implement/SKILL.md` Step 3 (coder dispatch, currently line ~191) is split into two phases: test-author first (must observe red bar), gate verification, then coder second (must observe green bar).
- AC-3: Handoff artefact at `.pipeline/context/test-author-output.json` is written by `test-author` with test file paths and failure log; coder reads this file but NOT the test-author's session transcript.
- AC-4: Red-phase verification: after test-author runs, the worker runs the relevant test file(s); if exit 0 (no failures), the skill emits a warning and aborts (test is too weak, per §3.3). The abort message identifies which test file passed without implementation.
- AC-5: Green-phase verification: after coder runs, the same test command must exit 0 for the new test files; if exit non-zero, the coder revision loop (max 2 passes, per existing SKILL.md Step 5b) applies.
- AC-6: `scripts/test-author-wave.test.mjs` contains failing tests for wave-split mechanics (test-author called before coder; red-phase abort when test passes without implementation); exits non-zero before implementation.
- AC-7: `.pipeline/agent-roles.json` includes `test-author` with `allowedPaths` covering the test-file discovery patterns used by `scripts/run-tests.mjs` (i.e., `hooks/*-test.js`, `mcp/*-test.mjs`, `scripts/*-test.mjs`) plus the JSON handoff path `.pipeline/context/test-author-output.json`.

## Out of scope

- Renaming `coder` agent — keep the name; only change invocation context.
- Auto-generating tests when missing from the plan (separate concern).
- Replacing `reviewer-style` with `reviewer-tests` (sibling TODO `48bddb1b`, already done).
- `skills/debug/SKILL.md` and `skills/refactor/SKILL.md` wave split — the test-author pattern applies only to feature implementation. Debug and refactor pipelines do not have a red-phase authoring step; they already have an existing failing state.
- `forge-config.default.json` model routing entry — `agentModelMap` drives `forge_get_model_recommendation` results; `test-author` will fall back to frontmatter `model:` field per CLAUDE.md routing rule 4. A dedicated `agentModelMap` entry is a follow-up optimisation, not a blocker.

## Surface

| File | Change | Citation |
|---|---|---|
| `agents/test-author.md` | New file — ~80 lines | AC-1 |
| `skills/implement/SKILL.md` | Split Step 3.2 (line ~191) into test-author + red gate + coder | AC-2, AC-4, AC-5 |
| `.pipeline/agent-roles.json` | Add `test-author` entry | AC-7 |
| `scripts/test-author-wave.test.mjs` | New test file — wave-split mechanics | AC-6 |
| `.pipeline/context/test-author-output.json` | Runtime artefact path (no source edit) | AC-3 |

`scripts/run-tests.mjs` discovery pattern (lines 23-26): `hooks/*-test.js`, `mcp/*-test.mjs`, `scripts/*-test.mjs`. No `--files=` flag exists — AC-4 uses `node --test <absolute-path>` directly, not `run-tests.mjs`. This is the correct invocation for a single file.

## Risks

- `skills/implement/SKILL.md` Phase Execution Loop (lines 139-174) already handles multi-phase plans with per-phase coder invocations. The test-author split must integrate with the loop — not bypass it. The split applies at the coder-dispatch sub-step within each phase, not as a new outer loop.
- `coder` agent's `allowedPaths` in `agent-roles.json` is `["docs/context/handoff.md"]` (line 19). This is narrower than the coder's actual source-write behavior. Pre-existing inconsistency — do not change it as part of this feature.

---

#### Phase 1 — Failing tests (TDD wave 1 — red bar)

- [ ] 1. Write failing tests for wave-split mechanics (`scripts/test-author-wave.test.mjs`) (wave: 1)
  Intent: Establish the red bar before any implementation — confirms TDD wave separation per research §3.2 and §4.2; tests must fail because the test-author agent and wave-split skill logic do not yet exist.
  Verify: AC-6: `node --test scripts/test-author-wave.test.mjs` exits non-zero; test cases assert (a) the wave-split step list includes a `test-author` invocation before the coder step (parsed from `skills/implement/SKILL.md` text), (b) the red-phase abort fires when a test file exits 0 without source changes, (c) the coder receives `[test-author-output: .pipeline/context/test-author-output.json]` signal and not the full test-author transcript. No `.skip` markers; at least one assertion per case.

#### Phase 2 — Implementation (TDD wave 2 — green bar)

- [ ] 2. Create `agents/test-author.md` with handoff schema embedded (`agents/test-author.md`) (wave: 2)
  Intent: Provide the isolated test-author agent so the pipeline can dispatch it with a context window that contains no implementation reasoning, eliminating the §3.3 failure mode. Embeds the JSON handoff artefact spec to avoid forward-references.
  Verify: AC-1 + AC-3: File exists with valid YAML frontmatter (`name: test-author`, `description: <one-line>`, `model: claude-haiku-4-5-20251001`, `tools: [Read, Write, Glob, Grep, Bash]`), `## Permissions` section with `### Always` (read test discovery paths, write within allowedPaths, run `node --test`), `### Ask First` (none — agent is autonomous within its allowedPaths), `### Never` (edit any non-test source file; read or write outside allowedPaths; emit reasoning narrative into the handoff artefact). Each sub-heading has at least one substantive bullet per GENERAL.md:105-126. The agent body documents the JSON handoff schema at `.pipeline/context/test-author-output.json` with required fields `phase`, `testFiles[]`, `failureOutput`, `exitCode` and forbids any `reasoning` / `notes` fields.

- [ ] 3. Add `test-author` to `.pipeline/agent-roles.json` (`.pipeline/agent-roles.json`) (wave: 2)
  Intent: Permit `test-author` to write test files and its JSON handoff artefact without being blocked by `hooks/ctx-pre-tool.js` write-target enforcement.
  Verify: AC-7: `.pipeline/agent-roles.json` contains `"test-author": { "allowedPaths": ["hooks/*-test.js", "mcp/*-test.mjs", "scripts/*-test.mjs", ".pipeline/context/test-author-output.json"] }`; JSON is valid; no other entries modified.

- [ ] 4. Split coder dispatch in `skills/implement/SKILL.md` into test-author + coder waves (`skills/implement/SKILL.md`) (wave: 2)
  Intent: Enforce subagent isolation (§4.2) in the implement skill by inserting test-author dispatch as **Step 3.0** (between Step 2b scoping and Step 3.1 coder-scout) inside the Phase Execution Loop, with conditional skip and red-phase verification.
  Verify: AC-2, AC-4, AC-5:
  - Step 3.0 receives `[phase-scope: <label>]` signal mirroring the coder pattern (SKILL.md line 147).
  - Step 3.0 runs **conditionally**: if the current phase has no test-file tasks (i.e., the phase's task lines do not target paths matching `*-test.{js,mjs}`), Step 3.0 is **skipped** with log `[wave-split] phase has no test files — skipping test-author`; loop advances to Step 3.1.
  - Step 3.0 writes test files scoped to the current phase's task lines only.
  - Red-phase check: a single batched `node --test <file1> <file2> ... <fileN>` invocation per phase; if exit 0 (red-phase failed to fail), skill aborts with `[wave-split] handoff invalid — aborting phase`. Single subprocess amortizes startup cost.
  - Coder receives `[test-author-output: .pipeline/context/test-author-output.json]` signal in its prompt but NOT the test-author session transcript.
  - Green-phase check after coder: same batched invocation must exit 0; if non-zero, existing coder revision loop (Step 5b) applies.
  - Split nests inside the existing Phase Execution Loop (lines 139-174) — does not bypass it.
  Depends: 2, 3

#### Phase 3 — Regression (TDD wave N)

- [ ] 5. Full regression suite green (`scripts/test-author-wave.test.mjs`, `hooks/tdd-guard.test.mjs`, `scripts/lean-risk-classify.test.mjs`, `scripts/reviewer-tests-dispatch.test.mjs`) (wave: 3)
  Depends: 4
  Intent: Confirm that the wave-split implementation satisfies the failing tests from Phase 1 and does not break existing TDD-guard, classifier, or reviewer-dispatch tests.
  Verify: `node --test scripts/test-author-wave.test.mjs` exits 0 AND `node scripts/run-tests.mjs` exits 0 (all discovered test files pass); no test cases skipped or deleted.

### Research needed

(None — all questions resolved from required reads. Key finding: `scripts/run-tests.mjs` has no `--files=` flag; AC-4 red-phase verification uses `node --test <absolute-path>` directly. `forge-config.default.json` model routing deferred to follow-up per out-of-scope decision above.)

### Resolution of plan-stage reviewer verdicts (test-author feature)

Plan-stage reviewers ran against this feature: `reviewer-safety` APPROVED (0/0); `reviewer-boundary` REVISE (0 blockers, 3 warnings); `reviewer-logic` REVISE (0 blockers, 2 warnings); `reviewer-performance` REVISE (0 blockers, 1 warning). No BLOCKERs — gate1 proceeds with the following spec-precision clarifications pinned into the plan body:

**reviewer-boundary AC-1 — Permissions schema underspecified:** Resolution applied. AC-1 is **tightened** to mandate that `agents/test-author.md` declare:
- YAML frontmatter with required fields `name: test-author`, `description: <one-line>`, `model: claude-haiku-4-5-20251001`, `tools: [Read, Write, Glob, Grep, Bash]` (no optional fields permitted unless added consciously).
- `## Permissions` section with three required sub-headings in order: `### Always` (read test discovery paths, write within allowedPaths, run `node --test`), `### Ask First` (none — agent is autonomous within its allowedPaths), `### Never` (edit any non-test source file; read or write outside allowedPaths; emit reasoning narrative into the handoff artefact). Each sub-heading must contain at least one substantive bullet per GENERAL.md:105–126.

**reviewer-boundary AC-2 + reviewer-logic phase-zero edge case — Phase Execution Loop integration point:** Resolution applied. AC-2 is **clarified**: test-author dispatch occurs as a new **Step 3.0** in the Phase Execution Loop, inserted between Step 2b (scoping check) and Step 3.1 (coder-scout). Step 3.0:
- Receives `[phase-scope: <label>]` signal mirroring the coder pattern (SKILL.md line 147).
- Runs **conditionally**: if the current phase has no test-file tasks (i.e., the phase's task lines do not target paths matching `*-test.{js,mjs}`), Step 3.0 is **skipped** (logged `[wave-split] phase has no test files — skipping test-author`) and the loop advances to Step 3.1 directly.
- Writes test files scoped to the current phase's task lines only — not all phases.
- The red-phase verification (AC-4) runs only on test files written by Step 3.0 in the current phase iteration.

**reviewer-boundary AC-3 + reviewer-logic forward-reference — handoff artefact schema and timing:** Resolution applied. AC-3 is **tightened**:
- Test-author writes a **JSON artefact** at `.pipeline/context/test-author-output.json` (machine-readable, not Markdown). Schema:
  ```json
  {
    "phase": "<phase label>",
    "testFiles": ["<absolute-path>", ...],
    "failureOutput": "<raw node --test stderr/stdout combined>",
    "exitCode": <number>
  }
  ```
- The Markdown file `docs/context/test-author-handoff.md` is **dropped** in favor of the JSON artefact above. Sections like `## Reasoning` cannot exist because the schema has no such field.
- Coder reads the JSON artefact via the prompt signal `[test-author-output: .pipeline/context/test-author-output.json]` and validates the schema before consuming. If the file is missing, malformed, or `exitCode === 0` (red-phase failed to fail), the coder aborts with `[wave-split] handoff invalid — aborting phase`.
- **Timing fix:** the handoff schema is defined in **Task 2** (Wave 2 — when `agents/test-author.md` is created), not a separate later task. Original Task 5 (forward-referenced spec write) is **removed** as redundant; its content folds into Task 2.

**reviewer-logic AC-6 — Test structure clarity:** Resolution applied. AC-6 is **tightened**. `scripts/test-author-wave.test.mjs` asserts at the **module-import level** by importing the relevant skill helpers (or, if the wave-split lives inline in SKILL.md prose, by AST-checking the SKILL.md text via regex). Specifically:
- (a) Test asserts that a parsed-step list extracted from `skills/implement/SKILL.md` Phase Execution Loop section contains the literal token `test-author` at an index strictly less than the index of the literal token `coder`. Implementation: `readFileSync` SKILL.md, regex-extract step labels, assert ordering. Fails before SKILL.md edit because `test-author` does not appear.
- (b) Test imports a small helper exported from a new `scripts/wave-split.mjs` (or inline in `scripts/run-tests.mjs` if minimal) that simulates `redPhaseAbort({ exitCode: 0, testFile })` and asserts the function returns `{ aborted: true, reason: /passed without implementation/ }`. Fails before implementation because the function does not exist.
- (c) Test reads the coder prompt template (wherever it lives — likely `skills/implement/SKILL.md` Step 3.2 prose) and asserts the template contains the literal token `[test-author-output: .pipeline/context/test-author-output.json]` and does NOT contain the literal phrase `test-author transcript` or similar leakage indicators.

**reviewer-performance — Test command batching:** Resolution applied. The red-phase verification (AC-4) **batches** test files: `node --test <file1> <file2> ... <fileN>` in a single invocation per phase. Implementation note added to Task 4: red-phase check uses a single `node --test` subprocess with all phase test files as arguments to amortize startup cost.

**Surface deltas from these resolutions:**
- Original Task 5 (Wave 3 handoff spec) is **removed**. Its content folds into Task 2.
- New helper file `scripts/wave-split.mjs` may be needed for testable red-phase abort logic (Task 1 case b). Implementer's call: inline in SKILL.md prose if testable via AST regex; extracted helper if cleaner.
- Handoff artefact path: `.pipeline/context/test-author-output.json` (JSON, replaces the originally-proposed Markdown path).
- AC-7 `allowedPaths`: `["hooks/*-test.js", "mcp/*-test.mjs", "scripts/*-test.mjs", ".pipeline/context/test-author-output.json"]`.

These resolutions are authoritative; implementer must reference them when there's ambiguity. Original AC text above is **superseded** by the narrowed wording in this section where they conflict.

### Approach summary
- Decision: New `test-author` agent (Haiku, isolated context) inserted as Step 3.0 in the Phase Execution Loop of `skills/implement/SKILL.md`; handoff is a JSON artefact at `.pipeline/context/test-author-output.json` carrying test paths + failure output + exit code; built TDD-first per GENERAL.md §TDD discipline.
- Trade-off: `skills/debug/SKILL.md` and `skills/refactor/SKILL.md` are out of scope — they start from an existing failure state and the test-author pattern does not apply.
- Uncertainty: The Phase Execution Loop in `skills/implement/SKILL.md` (lines 139-174) already handles per-phase coder dispatch; the split nests inside that loop as Step 3.0 with conditional skip when a phase has no test files (per Resolution above).
