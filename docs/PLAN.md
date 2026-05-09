## Active Plan

(Stale prior feature blocks removed by conductor at gate1 of r-a9fed562. Already shipped today: TDD Guard Hook via merge 5072aad2. The active plan below targets the reviewer-tests agent — a separate feature.)

### Feature: reviewer-tests agent

Summary: Add a diff-aware `reviewer-tests` agent that BLOCKs handoffs containing test-weakening patterns, closes board TODO `48bddb1b`.

#### Goal

`reviewer-tests` is a post-coder reviewer that reads the git diff and blocks merge of any handoff that weakens the test suite. It catches four categories: (1) deleted or loosened assertions, (2) new mocks of production paths, (3) added lint/type-check disable comments, (4) added or expanded skip/xfail markers. It runs in the implement pipeline in parallel with other reviewers whenever a handoff touches test files or adds suppression keywords. The agent itself is built test-first per FORGE TDD discipline.

#### Acceptance criteria

- AC-1: Given a diff deleting an `expect(...)` or `assert(...)` line in a test file, reviewer-tests outputs `verdict: BLOCK` with file:line citation.
- AC-2: ~~test rename detection~~ — **SUPERSEDED** by Resolution section below. AC-2 narrowed: BLOCK on any assertion deletion in a test file regardless of whether the enclosing function was renamed.
- AC-3: Given a diff adding `jest.mock(`, `vi.mock(`, `sinon.stub(`, `unittest.mock.patch` wrapping a production module that was previously called directly, reviewer-tests outputs `verdict: BLOCK` with citation.
- AC-4: Given a diff adding `// eslint-disable`, `/* eslint-disable`, `# noqa`, `@ts-ignore`, `@ts-expect-error`, or `# type: ignore` near changed lines, reviewer-tests outputs `verdict: BLOCK` or `REVISE` with file:line citation.
- AC-5: Given a diff adding `it.skip(`, `describe.skip(`, `xit(`, `xdescribe(`, `test.skip(`, `@pytest.mark.skip`, `@pytest.mark.xfail`, or `t.Skip()`, reviewer-tests outputs `verdict: BLOCK` with citation.
- AC-6: Given a clean diff with no test weakening patterns, reviewer-tests outputs `verdict: APPROVED`.
- AC-7: ~~broad keyword dispatch~~ — **SUPERSEDED** by Resolution section below. AC-7 tightened to require keyword matches inside hunks of test-file paths only.
- AC-8: ~~frontmatter unspecified~~ — **SUPERSEDED** by Resolution section below. AC-8 mandates: `model: claude-haiku-4-5-20251001`, `maxTurns: 1`, `effort: "low"`, `tools: [Read, Glob, Grep, Write]`.
- AC-9: `.pipeline/agent-roles.json` contains `"reviewer-tests": { "allowedPaths": ["docs/context/reviewer-output/**"] }`.
- AC-10: `node --test scripts/reviewer-tests-dispatch.test.mjs` exits 0 (all dispatch-routing tests pass).
- AC-11: Full regression suite (`node --test hooks/tdd-guard.test.mjs && node --test scripts/lean-risk-classify.test.mjs && node --test scripts/reviewer-tests-dispatch.test.mjs`) exits 0.

#### Out of scope

- The agent does not run actual tests — it only reads the git diff.
- The agent does not replace `reviewer-logic` or `reviewer-safety`.
- No semantic analysis of whether a mock is "legitimate" — all new mocks of previously-direct production paths are flagged; the human decides.
- No changes to `hooks/tdd-guard.js` or the TDD guard pipeline.
- No changes to `lean-risk-classify.mjs` — dispatch routing is handled entirely in `reviewer-dispatch.mjs`.

#### Detection rules (reference for coder)

| Category | Patterns | Verdict |
|---|---|---|
| Assertion deletion | `-\s*(expect\|assert\|should\|assertEquals\|assertThat)\s*\(` removed lines in test files | BLOCK |
| Assertion loosening | `toMatchSnapshot`, `toEqual(false)` replacing `toEqual(true)`, expected value replaced with `.*` wildcard or `any()` | REVISE |
| New mock of production path | `+.*\b(jest\.mock|vi\.mock|sinon\.stub|unittest\.mock\.patch|patch\s*\()` | BLOCK |
| Lint/type disable | `+.*\b(eslint-disable|noqa|@ts-ignore|@ts-expect-error|type:\s*ignore)` | REVISE (BLOCK if on assertion line) |
| Skip/xfail marker | `+.*\b(it\.skip|describe\.skip|xit\b|xdescribe|test\.skip|@pytest\.mark\.(skip|xfail)|t\.Skip\(\))` | BLOCK |

(Removed "Test rename without coverage" row per AC-2 narrowing.)

---

#### Phase 1 — Failing tests (TDD wave 1 — red bar)

- [ ] 1. Write failing tests for reviewer-tests dispatch routing (`scripts/reviewer-tests-dispatch.test.mjs`) (wave: 1)
  Intent: Establish the red bar for the dispatch-routing changes — tests must fail because `reviewer-tests` is not yet in the dispatch map, confirming TDD wave separation per research §3.2.
  Verify: AC-1 (partial): `node --test scripts/reviewer-tests-dispatch.test.mjs` exits non-zero; test cases cover: (a) diff touching `foo.test.js` dispatches `reviewer-tests`; (b) diff with `it.skip(` keyword INSIDE a test-file hunk dispatches `reviewer-tests`; (c) diff with `eslint-disable` keyword in a non-test file (e.g. `hooks/foo.js`) does NOT dispatch `reviewer-tests`; (d) clean diff with no test files and no keywords does NOT dispatch `reviewer-tests`; (e) `reviewer-tests` appears in the dispatch output alongside other triggered reviewers (not instead of them). Each case has at least one assertion; no `.skip` markers.

#### Phase 2 — Implementation (TDD wave 2 — green bar)

- [ ] 2. Create `agents/reviewer-tests.md` (`agents/reviewer-tests.md`) (wave: 2)
  Intent: Provide the agent definition so the pipeline can dispatch it; the agent reads the git diff and emits a structured verdict covering all four detection categories.
  Verify: AC-8 (per Resolution): File exists with valid YAML frontmatter `model: claude-haiku-4-5-20251001`, `maxTurns: 1`, `effort: "low"`, `tools: [Read, Glob, Grep, Write]`, and a `## Permissions` section with `### Always`, `### Ask First`, `### Never` sub-headings per GENERAL.md schema. Agent reads `docs/context/git-diff.txt`, scans for the five pattern categories in the detection table, emits verdict to `<outputDir>/reviewer-tests.md`, then emits `[reviewer-verdict]` signal. Plan-stage detection block present (mirrors other reviewers).

- [ ] 3. Add `reviewer-tests` to dispatch map in `scripts/reviewer-dispatch.mjs` (`scripts/reviewer-dispatch.mjs`) (wave: 2)
  Intent: Make `reviewer-tests` discoverable so it is automatically included when test files or suppression keywords are present in a handoff diff (per the narrowed AC-7).
  Verify: AC-7 (per Resolution) and AC-10: `node --test scripts/reviewer-tests-dispatch.test.mjs` exits 0 after this change; test cases (a)–(e) from Task 1 all pass. Dispatch logic adds `reviewer-tests` when EITHER (a) a `+++ b/` path matches test-file patterns (`*.test.*`, `*_test.*`, `*spec*`, `tests/**`), OR (b) keyword (`skip`, `mock`, `eslint-disable`, `noqa`, `@ts-ignore`) appears on a `+` line INSIDE a hunk whose enclosing file is a test-file per (a). Plan-stage: only dispatch if a task description contains the word `test` alongside any of the keywords; bare keyword match does not trigger.
  Depends: 1

- [ ] 4. Register `reviewer-tests` in `.pipeline/agent-roles.json` (`.pipeline/agent-roles.json`) (wave: 2)
  Intent: Allow `reviewer-tests` to write its verdict file without being blocked by `hooks/ctx-pre-tool.js` write-target enforcement.
  Verify: AC-9: `.pipeline/agent-roles.json` contains `"reviewer-tests": { "allowedPaths": ["docs/context/reviewer-output/**"] }`; JSON is valid; no other entries modified.

#### Phase 3 — Regression (TDD wave N)

- [ ] 5. Full regression suite green (`hooks/tdd-guard.test.mjs`, `scripts/lean-risk-classify.test.mjs`, `scripts/reviewer-tests-dispatch.test.mjs`) (wave: 3)
  Depends: 2, 3, 4
  Intent: Confirm that adding `reviewer-tests` does not break existing hook or classifier tests — no regressions from Tasks 2–4.
  Verify: AC-11: `node --test hooks/tdd-guard.test.mjs && node --test scripts/lean-risk-classify.test.mjs && node --test scripts/reviewer-tests-dispatch.test.mjs` all exit 0; no test cases skipped or deleted.

### Research needed

(All resolved — see `docs/RESEARCH/reviewer-tests-detection-patterns.md` and the Resolution sections below.)

### Open questions for the user

- Should lint/type disable comments always BLOCK (strict), or only REVISE with the option to override? Current plan proposes REVISE unless the disable appears on the same line as a removed assertion (then BLOCK). Confirm or adjust.
- Should `reviewer-tests` also run at **plan stage** (scanning PLAN.md task lines for keywords like "skip", "mock", "disable")? Current plan: yes (mirrors all other reviewers with plan-stage detection block), but the plan-stage scan will yield few real findings since plans don't contain test code.

### Resolution of plan-stage research findings

Researcher (`docs/RESEARCH/reviewer-tests-detection-patterns.md`) returned concrete answers to both unknowns:

1. **Assertion-loosening regex set** — five patterns ranked by confidence (high/medium/low) and false-positive risk. Coder must use these as the canonical pattern set for AC-4 / detection-table "Assertion loosening" row. All five emit REVISE (not BLOCK); BLOCK is reserved for loosening combined with a `-` line deleting a stricter assertion on the same test.
2. **Reviewer-output schema** — `scripts/verify-output.mjs` checks file mtime only, never parses content. The de facto schema is the four-section verdict file (`## <Type> Review: <Feature>`, `### Issues`, `### Verified`, `### Per-criterion verdicts`, `### Verdict`) plus a single `[reviewer-verdict] {...}` JSON signal line on stdout. Coder must mirror the structure used by `agents/reviewer-logic.md` / `agents/reviewer-boundary.md`.

### Resolution of plan-stage reviewer verdicts

Plan-stage reviewers: `reviewer-boundary` APPROVED (0/0); `reviewer-logic` REVISE (0 blockers, 2 warnings); `reviewer-performance` REVISE (0 blockers, 2 warnings). No BLOCKERs — gate1 proceeds with the following spec-precision clarifications pinned into the plan body:

**reviewer-logic warning — AC-2 test rename detection underspecified:** Resolution applied. AC-2 is **narrowed**: BLOCK if assertion deletion is detected on a test function (regardless of whether the function name changed). The agent does not attempt rename-vs-deletion-vs-addition disambiguation — that requires AST analysis beyond v1 scope. Detection-table row "Test rename without coverage" is removed; assertion-deletion row already covers the failure mode.

**reviewer-logic + reviewer-performance warning — AC-7 dispatch over-triggers:** Resolution applied. AC-7 is **tightened** as follows:
- AC-7(a) (test-file path match) is unchanged: `*.test.*`, `*_test.*`, `*spec*`, `tests/**` paths in `+++ b/` lines trigger reviewer-tests.
- AC-7(b) (keyword scan) is **narrowed to require keywords on newly-added (`+`) lines AND inside hunks that touch a test-file path** — i.e., the keyword must appear in a `+` line of a hunk whose enclosing file is a test file per AC-7(a). Keywords in non-test files (e.g. `eslint-disable` in `hooks/foo.js`) do NOT trigger reviewer-tests.
- Plan-stage scan: only dispatch reviewer-tests if a task description explicitly contains the word `test` alongside any of the keywords. Bare keyword match in plan text does not trigger.

This eliminates the false-positive fan-out flagged by both reviewers. Task 3 coder must implement the AND logic; Task 1 test cases must be updated to assert the narrowed behavior (clean-diff-with-eslint-disable-in-non-test-file does NOT dispatch).

**reviewer-performance warning — AC-8 frontmatter budget unspecified:** Resolution applied. AC-8 now mandates: `model: claude-haiku-4-5-20251001`, `maxTurns: 1`, `effort: "low"`, `tools: [Read, Glob, Grep, Write]`. These match the existing reviewer pattern and keep latency within the 30–90s reviewer budget.

These resolutions are authoritative; implementer must reference them when there's ambiguity. AC-2 and AC-7 in the original AC list above are **superseded** by the narrowed wording in this section.

### Approach summary
- Decision: New `reviewer-tests` agent following existing reviewer pattern; dispatch routing added to `reviewer-dispatch.mjs` only (no `lean-risk-classify.mjs` change needed); built TDD-first with Wave 1 dispatch tests, Wave 2 implementation, Wave 3 regression.
- Trade-off: Detection is pattern-based on the diff text; semantic analysis (e.g. detecting that a new mock wraps a previously-direct call) requires reading the full file which the agent can do but adds latency.
- Uncertainty: All plan-stage unknowns resolved (research findings + reviewer warnings pinned in Resolution sections above).

---

### Feature: test-author agent and pipeline split

Summary: Add a `test-author` agent and split the implement pipeline into test-author (red) → coder (green) waves, closing board TODO `2e73852d`.

## Context

Board TODO `2e73852d` — research §3.2 (Red+Green collapse), §3.3 (tests that pass before implementation), §4.2 (subagent isolation), §6.2 (FORGE-shaped pipeline-staged pattern), §9.2 (test-author on Haiku). Sibling work: `reviewer-tests` agent (TODO `48bddb1b`) ships diff-aware test-weakening detection; `tdd-guard` hook (TODO `e0450cf5`) is already DONE. This feature adds the upstream structural split: a separate agent authors the failing tests before the coder sees the feature.

The single-agent coder context failure: even with TDD-structured planning, the coder sees the plan, mentally drafts the implementation, then writes tests the mental implementation will satisfy (§3.3). Subagent isolation (§4.2) eliminates this by having a different agent — with no memory of the coder conversation — write the implementation. The coder receives only test file paths + failure log, not the test-author's reasoning trace.

## Acceptance criteria

- AC-1: `agents/test-author.md` exists with valid YAML frontmatter (`name`, `description`, `model`, `tools`) and a `## Permissions` section with `### Always`/`### Ask First`/`### Never` per GENERAL.md schema. `allowedPaths` in the prompt body restricts writes to test-file patterns only (`*-test.js`, `*-test.mjs`, `scripts/*-test.mjs`, `hooks/*-test.js`).
- AC-2: `skills/implement/SKILL.md` Step 3 (coder dispatch, currently line ~191) is split into two phases: test-author first (must observe red bar), gate verification, then coder second (must observe green bar).
- AC-3: Handoff artefact at `docs/context/test-author-handoff.md` is written by `test-author` with test file paths and failure log; coder reads this file but NOT the test-author's session transcript.
- AC-4: Red-phase verification: after test-author runs, the worker runs the relevant test file(s); if exit 0 (no failures), the skill emits a warning and aborts (test is too weak, per §3.3). The abort message identifies which test file passed without implementation.
- AC-5: Green-phase verification: after coder runs, the same test command must exit 0 for the new test files; if exit non-zero, the coder revision loop (max 2 passes, per existing SKILL.md Step 5b) applies.
- AC-6: `scripts/test-author-wave.test.mjs` contains failing tests for wave-split mechanics (test-author called before coder; red-phase abort when test passes without implementation); exits non-zero before implementation.
- AC-7: `.pipeline/agent-roles.json` includes `test-author` with `allowedPaths` covering the test-file discovery patterns used by `scripts/run-tests.mjs` (i.e., `hooks/*-test.js`, `mcp/*-test.mjs`, `scripts/*-test.mjs`).

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
| `docs/context/test-author-handoff.md` | Runtime artefact path (no source edit) | AC-3 |

`scripts/run-tests.mjs` discovery pattern (lines 23-26): `hooks/*-test.js`, `mcp/*-test.mjs`, `scripts/*-test.mjs`. No `--files=` flag exists — AC-4 uses `node --test <absolute-path>` directly, not `run-tests.mjs`. This is the correct invocation for a single file.

## Risks

- `skills/implement/SKILL.md` Phase Execution Loop (lines 139-174) already handles multi-phase plans with per-phase coder invocations. The test-author split must integrate with the loop — not bypass it. The split applies at the coder-dispatch sub-step within each phase, not as a new outer loop.
- `coder` agent's `allowedPaths` in `agent-roles.json` is `["docs/context/handoff.md"]` (line 19). This is narrower than the coder's actual source-write behavior. Pre-existing inconsistency — do not change it as part of this feature.

---

#### Phase 1 — Failing tests (TDD wave 1 — red bar)

- [ ] 1. Write failing tests for wave-split mechanics (`scripts/test-author-wave.test.mjs`) (wave: 1)
  Intent: Establish the red bar before any implementation — confirms TDD wave separation per research §3.2 and §4.2; tests must fail because the test-author agent and wave-split skill logic do not yet exist.
  Verify: AC-6: `node --test scripts/test-author-wave.test.mjs` exits non-zero; test cases assert (a) the wave-split step list includes a `test-author` invocation before the coder step, (b) the red-phase abort fires when a test file exits 0 without source changes, (c) the coder receives `docs/context/test-author-handoff.md` path and not the full test-author transcript. No `.skip` markers; at least one assertion per case.

#### Phase 2 — Implementation (TDD wave 2 — green bar)

- [ ] 2. Create `agents/test-author.md` (`agents/test-author.md`) (wave: 2)
  Intent: Provide the isolated test-author agent so the pipeline can dispatch it with a context window that contains no implementation reasoning, eliminating the §3.3 failure mode.
  Verify: AC-1: File exists with valid YAML frontmatter (`name: test-author`, `model: claude-haiku-4-5-20251001`, `tools: [Read, Write, Glob, Grep, Bash]`), `## Permissions` with `### Always`/`### Ask First`/`### Never` per GENERAL.md schema; `### Never` prohibits editing source files (non-test paths); agent writes test files to discovery-pattern paths only and writes `docs/context/test-author-handoff.md` as its output artefact.

- [ ] 3. Add `test-author` to `.pipeline/agent-roles.json` (`.pipeline/agent-roles.json`) (wave: 2)
  Intent: Permit `test-author` to write test files and its handoff artefact without being blocked by `hooks/ctx-pre-tool.js` write-target enforcement.
  Verify: AC-7: `.pipeline/agent-roles.json` contains `"test-author": { "allowedPaths": ["hooks/*-test.js", "mcp/*-test.mjs", "scripts/*-test.mjs", "docs/context/test-author-handoff.md"] }`; JSON is valid; no other entries modified.

- [ ] 4. Split coder dispatch in `skills/implement/SKILL.md` into test-author + coder waves (`skills/implement/SKILL.md`) (wave: 2)
  Intent: Enforce subagent isolation (§4.2) in the implement skill by inserting the test-author step before coder dispatch and adding red-phase and green-phase verification checkpoints.
  Verify: AC-2, AC-4, AC-5: `skills/implement/SKILL.md` Step 3 contains (a) test-author dispatch before coder dispatch; (b) red-phase check: run `node --test <test-file-path>` on new test files, abort with warning if exit 0; (c) coder receives `[test-author-handoff: <path>]` signal in its prompt but not the test-author session; (d) green-phase check after coder runs confirms test exit 0; (e) the split integrates with the Phase Execution Loop (lines 139-174) without bypassing it.
  Depends: 2, 3

- [ ] 5. Write `docs/context/test-author-handoff.md` artefact spec into `agents/test-author.md` (`agents/test-author.md`) (wave: 3)
  Intent: Guarantee the handoff artefact contains exactly the information the coder needs (test file paths + failure messages) and nothing that leaks the test-author's implementation reasoning.
  Verify: AC-3: `agents/test-author.md` `### Always` section specifies writing `docs/context/test-author-handoff.md` with: (a) a `## Test files written` section listing absolute paths; (b) a `## Failure output` section with the raw `node --test` exit output; (c) no `## Reasoning` or design narrative sections. Coder's prompt in `skills/implement/SKILL.md` includes `[test-author-handoff: docs/context/test-author-handoff.md]` and instructs coder to read only that file, not the test-author session.
  Depends: 2, 4

#### Phase 3 — Regression (TDD wave N)

- [ ] 6. Full regression suite green (`scripts/test-author-wave.test.mjs`, `hooks/tdd-guard.test.mjs`, `scripts/lean-risk-classify.test.mjs`, `scripts/reviewer-tests-dispatch.test.mjs`) (wave: 4)
  Depends: 4, 5
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
- **Timing fix:** the handoff schema is defined in **Task 2** (Wave 2 — when `agents/test-author.md` is created), not Task 5. Task 5 is **removed** as redundant; its content folds into Task 2.

**reviewer-logic AC-6 — Test structure clarity:** Resolution applied. AC-6 is **tightened**. `scripts/test-author-wave.test.mjs` asserts at the **module-import level** by importing the relevant skill helpers (or, if the wave-split lives inline in SKILL.md prose, by AST-checking the SKILL.md text via regex). Specifically:
- (a) Test asserts that a parsed-step list extracted from `skills/implement/SKILL.md` Phase Execution Loop section contains the literal token `test-author` at an index strictly less than the index of the literal token `coder`. Implementation: `readFileSync` SKILL.md, regex-extract step labels, assert ordering. Fails before SKILL.md edit because `test-author` does not appear.
- (b) Test imports a small helper exported from a new `scripts/wave-split.mjs` (or inline in `scripts/run-tests.mjs` if minimal) that simulates `redPhaseAbort({ exitCode: 0, testFile })` and asserts the function returns `{ aborted: true, reason: /passed without implementation/ }`. Fails before implementation because the function does not exist.
- (c) Test reads the coder prompt template (wherever it lives — likely `skills/implement/SKILL.md` Step 3.2 prose) and asserts the template contains the literal token `[test-author-output: .pipeline/context/test-author-output.json]` and does NOT contain the literal phrase `test-author transcript` or similar leakage indicators.

**reviewer-performance — Test command batching:** Resolution applied. The red-phase verification (AC-4) **batches** test files: `node --test <file1> <file2> ... <fileN>` in a single invocation per phase. Implementation note added to Task 4: red-phase check uses a single `node --test` subprocess with all phase test files as arguments to amortize startup cost.

**Surface deltas from these resolutions:**
- Task 5 (originally Wave 3 handoff spec) is **removed**. Its content folds into Task 2.
- New helper file `scripts/wave-split.mjs` may be needed for testable red-phase abort logic (Task 1 case b). Implementer's call: inline in SKILL.md prose if testable via AST regex; extracted helper if cleaner.
- Handoff artefact path changes from `docs/context/test-author-handoff.md` (Markdown) to `.pipeline/context/test-author-output.json` (JSON). Update AC-3 and Task 2 accordingly. Update `.pipeline/agent-roles.json` `allowedPaths` for test-author to include `.pipeline/context/test-author-output.json` (replaces the markdown path in AC-7).
- AC-7 `allowedPaths`: `["hooks/*-test.js", "mcp/*-test.mjs", "scripts/*-test.mjs", ".pipeline/context/test-author-output.json"]`.

These resolutions are authoritative; implementer must reference them when there's ambiguity. Original AC text above is **superseded** by the narrowed wording in this section where they conflict.

### Approach summary
- Decision: New `test-author` agent (Haiku, isolated context) inserted as Step 3.0 in the Phase Execution Loop of `skills/implement/SKILL.md`; handoff is a JSON artefact at `.pipeline/context/test-author-output.json` carrying test paths + failure output + exit code; built TDD-first per GENERAL.md §TDD discipline.
- Trade-off: `skills/debug/SKILL.md` and `skills/refactor/SKILL.md` are out of scope — they start from an existing failure state and the test-author pattern does not apply.
- Uncertainty: The Phase Execution Loop in `skills/implement/SKILL.md` (lines 139-174) already handles per-phase coder dispatch; the split nests inside that loop as Step 3.0 with conditional skip when a phase has no test files (per Resolution above).
