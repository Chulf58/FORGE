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

---

### Feature: impact-mapped test traceability via @covers tags

Summary: Every test file declares covered source files via `@covers`; post-handoff verification proves the specific tests for touched files pass, not just the full suite.

#### Phase 1 — Failing tests (TDD wave 1 — red bar)

- [ ] 1. Write failing tests for the `@covers` parser (`scripts/covers-parser-test.mjs`) (wave: 1)
  Intent: Establish a red bar for tag parsing before any implementation exists — prevents Red+Green collapse per research §3.2.
  Verify: AC-1: `node --test scripts/covers-parser-test.mjs` exits non-zero; test cases assert (a) a file with `// @covers scripts/lean-risk-classify.mjs` returns `{ covered: ['scripts/lean-risk-classify.mjs'] }`, (b) a file with no `@covers` tag returns `{ covered: [] }`, (c) multiple `@covers` lines in one file are all collected. No `.skip` markers.

- [ ] 2. Write failing tests for the impact-map builder (`scripts/covers-map-test.mjs`) (wave: 1)
  Intent: Establish a red bar for the glob-to-map aggregation before any implementation exists.
  Verify: AC-2: `node --test scripts/covers-map-test.mjs` exits non-zero; test cases assert (a) given two fixture test files each declaring `@covers`, the map returns `srcFile → [testFile, …]` with correct entries, (b) a test file declaring no `@covers` contributes no entries to the map. No `.skip` markers.

- [ ] 3. Write failing tests for the post-handoff coverage verifier (`scripts/covers-verify-test.mjs`) (wave: 1)
  Intent: Establish a red bar for the verifier logic before implementation — confirms the verifier reads handoff "Files modified", resolves covering tests, and reports missing coverage.
  Verify: AC-3: `node --test scripts/covers-verify-test.mjs` exits non-zero; test cases assert (a) a touched src file with a covering test triggers `node --test <testFile>` and reports PASS/FAIL, (b) a touched src file with zero `@covers` references emits a `[covers-gap]` line on stderr, (c) a touched src file with a covering test that fails causes the verifier to exit non-zero. No `.skip` markers.

#### Phase 2 — Implementation (TDD wave 2 — green bar)

- [ ] 4. Implement `@covers` tag parser (`scripts/covers-parser.mjs`) (wave: 2)
  Intent: Provide the pure function that extracts `@covers` declarations from a single test file's text so the map builder can aggregate without re-doing file I/O.
  Verify: AC-4: `node --test scripts/covers-parser-test.mjs` exits 0; parser accepts a file-content string, returns `{ covered: string[] }` with paths normalised to forward-slash repo-relative form; handles zero, one, and many `@covers` lines per file.
  Depends: 1

- [ ] 5. Implement impact-map builder (`scripts/covers-map.mjs`) (wave: 2)
  Intent: Aggregate per-file parser output into the project-wide `srcFile → [testFile, …]` map so the verifier and other consumers have a single lookup.
  Verify: AC-5: `node --test scripts/covers-map-test.mjs` exits 0; builder globs `hooks/*-test.js`, `mcp/*-test.mjs`, `scripts/*-test.mjs`, reads each with the parser, returns a plain-object map keyed by source path; no I/O side effects beyond file reads.
  Depends: 2, 4

- [ ] 6. Implement post-handoff coverage verifier (`scripts/covers-verify.mjs`) (wave: 2)
  Intent: Prove that tests covering the coder's touched files pass — moving the pipeline guarantee from "suite green" to "relevant tests green + no coverage gap".
  Verify: AC-6: `node --test scripts/covers-verify-test.mjs` exits 0; verifier reads handoff "Files modified" section via `extractFilePaths` from `scripts/lib/handoff-utils.mjs`, resolves covering tests via the impact map, runs `node --test <file1> … <fileN>` (batched, single subprocess), emits `[covers-gap] <srcFile>` on stderr for any touched file with no `@covers` entry, exits non-zero when any test fails or when `--strict-gaps` flag is passed and gaps exist.
  Depends: 3, 5

- [ ] 7. Wire verifier into `skills/implement/SKILL.md` post-coder step (`skills/implement/SKILL.md`) (wave: 2)
  Intent: Make impact-map verification a mandatory post-coder step in the implement pipeline so coverage gaps surface before reviewers see the handoff.
  Verify: AC-7: `skills/implement/SKILL.md` contains a step that runs `node scripts/covers-verify.mjs --handoff=docs/context/handoff.md` after the coder writes the handoff and before reviewer dispatch; the step logs `[covers] <N> tests resolved, <M> gaps` to stderr; a gap does not block the pipeline but adds a `[covers-gap]` section to the handoff for reviewers.
  Depends: 6

- [ ] 8. Update coder agent instructions to declare `@covers` tags (`agents/coder.md`) (wave: 2)
  Intent: Ensure the coder adds `@covers` declarations when creating new test files, closing the coverage map going forward without requiring a backfill audit.
  Verify: AC-8: `agents/coder.md` contains a `### Always` bullet (under `## Permissions`) stating that every new test file written must include at least one `// @covers <src-path>` comment at the top; existing coder prose is not removed or restructured.
  Depends: 4

- [ ] 9. Add verifier entry to `.pipeline/agent-roles.json` (`.pipeline/agent-roles.json`) (wave: 2)
  Intent: Permit `covers-verify.mjs` to be invoked by the skill worker without triggering write-target enforcement on files it only reads.
  Verify: AC-9: `.pipeline/agent-roles.json` is valid JSON after edit; if a `scripts-runner` or equivalent entry is present it covers `scripts/covers-verify.mjs`; if no runner entry exists a comment in `skills/implement/SKILL.md` documents that the verifier runs as a Bash subprocess, not as a registered agent, so no agent-roles entry is needed — either outcome is acceptable.
  Depends: 6

- [ ] 10. Write one-shot backfill script (`scripts/covers-backfill.mjs`) (wave: 2)
  Intent: Add `@covers` tags to all existing test files that currently lack them in a single operator-run pass, seeding the impact map without blocking the pipeline on a gradual rollout.
  Verify: AC-10: Running `node scripts/covers-backfill.mjs --dry-run` prints the list of test files missing `@covers` and exits 0 without writing; running without `--dry-run` prepends `// @covers <inferred-src>` to each file using the heuristic "strip `-test` suffix and match against existing source paths"; backfill does not modify files that already have `@covers`.
  Depends: 4

#### Phase 3 — Regression (TDD wave N)

- [ ] 11. Full regression suite green after impact-map feature (`scripts/covers-parser-test.mjs`, `scripts/covers-map-test.mjs`, `scripts/covers-verify-test.mjs`) (wave: 3)
  Depends: 7, 8, 9, 10
  Intent: Confirm all three new test files pass and the existing suite (`node scripts/run-tests.mjs`) remains green — no regressions from new scripts or agent/skill edits.
  Verify: AC-11: `node --test scripts/covers-parser-test.mjs && node --test scripts/covers-map-test.mjs && node --test scripts/covers-verify-test.mjs` all exit 0; then `node scripts/run-tests.mjs` exits 0 with no skipped or deleted cases.

### Research needed

(None — all design decisions made from codebase evidence. Key findings: `extractFilePaths` in `scripts/lean-risk-classify.mjs` is the precedent for reading handoff "Files modified"; `scripts/run-tests.mjs` uses `node <path>` not `node --test`; backfill is recommended as a one-shot script rather than enforced going-forward only, because the impact map has zero entries until existing test files are tagged and the verifier would emit gaps for every pre-existing handoff run.)

### Approach summary
- Decision: Pure ESM parser + map builder + CLI verifier; wired into implement skill as a post-coder step; `@covers` tag syntax is `// @covers <repo-relative-src-path>` (JS comment, one source path per line, multiple lines allowed); TDD-structured in three waves per GENERAL.md §TDD discipline.
- Trade-off: Backfill is operator-triggered (`node scripts/covers-backfill.mjs`), not automatic — impact map is sparse until the operator runs it, so coverage gaps will be reported for pre-existing touched files on first few runs.
- Uncertainty: Heuristic for backfill path inference (strip `-test` suffix) may produce wrong paths for some edge-case test files; the `--dry-run` flag lets the operator review before committing.
