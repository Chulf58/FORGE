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
| Assertion loosening | `toMatchSnapshot`, `toEqual(true)→toEqual(false)`, expected value replaced with `.*` wildcard or `any()` | REVISE |
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
