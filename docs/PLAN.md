## Active Plan

(All features from r-38ea3166 completed and merged.)

- **stdin:** JSON payload with at minimum `tool_input.file_path` (used by **both** Write and Edit) and `cwd`. Confirmed by `hooks/workflow-guard.js:191-194` and `hooks/control-file-guard-test.js:146` — both tools use `file_path`. Coder should apply a defensive `tool_input.file_path || tool_input.path` extraction (per `workflow-guard.js:191-194` pattern) for robustness only; both Write and Edit use `file_path` as primary field. (See `docs/RESEARCH/tdd-guard-hook-unknowns.md` Q2.)
- **exit 0:** allow the tool call through.
- **exit 2 + stdout JSON deny envelope + stderr message:** block the tool call. Deny envelope shape from `bash-guard.js:16-26`: `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "<msg>" } }`. `console.error(msg)` provides the legacy stderr backup (`bash-guard.js:26`). Exit 2 alone is silently discarded by the current runtime (`bash-guard.js:15`).
- **stdin reading:** readline + timeout pattern, fail-open on parse error (`bash-guard.js:456-466`). Timeout constant from `hook-utils.js` (`STDIN_TIMEOUT_LONG`).

#### Source-file detection rule

Based on `hooks/workflow-guard.js:14-31` (`isSourceFile` function), which explicitly excludes `/.pipeline/`, `/docs/`, `/.claude/`, `/scaffolds/`, `/node_modules/`, `/.git/`, `/mcp/`, `/hooks/`, `/skills/`, `/bin/`. The tdd-guard must use a **narrower, additive rule**: intercept Write/Edit on files under `hooks/`, `bin/`, `scripts/`, `mcp/` that are NOT test files. Test file exclusion: path ends with `.test.js`, `.test.mjs`, or is under `__tests__/` or `tests/`. Config/doc exclusion: ends with `.md` or `.json` at project root level (matches workflow-guard.js:29-30 precedent).

**Trigger tools:** Write, Edit, **and MultiEdit** — `MultiEdit` is a distinct PreToolUse event (not an Edit alias), confirmed by Claude Code hooks reference; community practitioners use `"Edit|MultiEdit|Write"` as a three-part matcher. (See `docs/RESEARCH/tdd-guard-hook-unknowns.md` Q1.) `hooks/hooks.json` needs three matcher entries.

#### "Failing test exists" check — chosen mechanism

**Option (a): run the test file** — confirmed by research doc §4.1 (tdd-agentic-llm-setups.md:92-96): "Test reporter integration parses Vitest/Jest/pytest/etc. results. File-pattern validation: rule says 'edits to `src/foo.py` require a failing test in `tests/test_foo.py`.'" Research doc §3.1 (tdd-agentic-llm-setups.md:44-46) states: "the harness, not the agent, runs the tests; the harness, not the agent, decides green/red." Option (a) is the research-recommended mechanism.

Concrete: for a target file `hooks/foo.js`, the hook resolves a test file in this **deterministic order** (first match wins):
  1. Adjacent: `<dir>/<name>.test.js` or `<dir>/<name>.test.mjs` (e.g., `hooks/foo.test.js`)
  2. Sibling tests dir: `tests/<name>.test.js` or `tests/<name>.test.mjs`
  3. `__tests__/<name>.test.js` under the same directory

If found, runs `node --test <test-file>` with a short timeout. Decision tree:
  - Exit non-zero ⇒ a failing test exists ⇒ **allow** the write (TDD red phase confirmed). This includes the case where the test file imports a not-yet-existing source module (module-not-found ⇒ non-zero exit ⇒ valid red bar for the very-first write).
  - Exit 0 ⇒ all tests green OR no tests defined ⇒ **block** — no red phase observed.
  - Test file absent ⇒ **block** with a message directing the agent to write a failing test first.

**Known v1 limitation:** the hook cannot semantically verify that the failing test is *about* the target module — any failing test in the resolved test file counts. This is acceptable for v1 (file-path mapping); a v2 could parse test names. Document this in the deny message so agents understand the contract.

**Option (b) mtime:** rejected — research doc §3.3 (tdd-agentic-llm-setups.md:52-54) flags "tests that pass before implementation" as a failure mode that mtime cannot detect. A newer-than-source test file may contain only green tests.

**Option (c) sentinel file:** rejected — requires a companion PostToolUse hook writing sentinel files on every Bash test run; higher complexity and a separate failure surface.

#### Bypass mechanism

Env var `TDD_GUARD_BYPASS=1` — matches the session-toggle pattern described in research doc §4.1 (tdd-agentic-llm-setups.md:95). `bash-guard.js` uses `hasValidApprovalToken` from hook-utils; tdd-guard uses a simpler env-var check (no approval token needed — this is a developer opt-out, not a security boundary). A `.tddguardignore` file at project root can list path globs to skip (one per line).

#### Performance budget

<500 ms typical, <2 s worst case. `node --test <single-file>` on a fast local test file takes ~100–300 ms on this platform. Timeout guard: spawn with `timeout: 2000 ms`; on ETIMEDOUT — fail-open (allow the write, log a warning to stderr).

#### Failure modes

| Scenario | Behavior |
|---|---|
| Node not on PATH | Fail-open: `spawn` throws ENOENT → catch → `exitOk()` + stderr warning |
| Test file malformed / parse error | Fail-open: test runner exits non-zero → treated as failing test → allow write |
| Hook itself crashes / unhandled exception | Fail-open: `.catch(() => process.exit(0))` wraps main (same pattern as `bash-guard.js:466`) |
| Timeout (>2 s) | Fail-open: log warning, allow write |
| No test file found | Fail-closed: block write, message directs agent to write failing test first |
| Test file exists but contains zero test definitions (empty / only `.skip`) | Fail-closed: `node --test` exits 0 ⇒ treated as "all green" ⇒ **block**. Message: "test file has no executing tests — write a failing test first." |
| Test file imports not-yet-existing source module | Allow: module-not-found exits non-zero ⇒ counts as red bar (correct behavior for first-write TDD scaffold). |
| TDD_GUARD_BYPASS=1 | Fail-open: skip all checks, allow write |
| `.tddguardignore` glob match | Fail-open: skip checks for paths matched by glob; treated as a deliberate opt-out for documented exceptions. |

---

#### Phase 1 — Test cases for the hook (written first — TDD structure)

- [ ] 8a. Create minimal stub `hooks/tdd-guard.js` (wave: 1)
  Intent: Provide an importable module so Task 8b's tests can be authored against a real (but un-implemented) surface. Resolves reviewer-logic phase-ordering blocker — without a stub, `node --test hooks/tdd-guard.test.mjs` would fail with a module-load error rather than meaningful red-bar assertions.
  Verify: AC-8a: `hooks/tdd-guard.js` exists and exports the symbols the tests will exercise (e.g., `runGuard(payload, env): Promise<{exitCode, stderr}>`). The stub returns `exitCode: 0` unconditionally so that Task 8b's failure tests fail for the *right reason* (assertion mismatch, not import error). No production logic in the stub.

- [ ] 8b. Write failing tests for `hooks/tdd-guard.js` (`hooks/tdd-guard.test.mjs`) (wave: 1)
  Depends: 8a
  Intent: Establish the red bar for the hook itself — tests must fail because the stub returns the wrong answer, satisfying the TDD-structured requirement (research doc §3.2).
  Verify: AC-8b: `node --test hooks/tdd-guard.test.mjs` exits non-zero with the following test cases failing against the stub: (1) blocks Write when no test file exists for target; (2) blocks Write when test file exists but all tests pass (green); (3) blocks Write when test file exists but contains zero executing tests (empty / only `.skip`); (4) allows Write when test file exists and at least one test fails (red); (5) allows Write when test file imports not-yet-existing source module (module-not-found ⇒ non-zero exit); (6) allows Write on test files themselves; (7) allows Write when `TDD_GUARD_BYPASS=1` (bypass is checked **before** stdin parsing so a malformed payload + bypass still allows); (8) allows Write when path matches a `.tddguardignore` glob; (9) fail-open when `node --test` times out; (10) fail-open on hook stdin parse error; (11) fail-open when `spawn` throws ENOENT (node not on PATH). Each test case has at least one assertion; no `.skip`; no test deletion permitted to satisfy AC-9.

#### Phase 2 — Hook implementation

- [ ] 9. Implement `hooks/tdd-guard.js` (`hooks/tdd-guard.js`) (wave: 2)
  Depends: 8a, 8b
  Intent: Enforce the Red phase by blocking source-file writes until a failing test for the target module is observed, closing the Red+Green collapse failure mode documented in tdd-agentic-llm-setups.md:48-50.
  Verify: AC-9: All test cases from Task 8b pass (`node --test hooks/tdd-guard.test.mjs` exits 0) **without removing assertions, marking tests `.skip`, or deleting test cases authored in Task 8b**. The 11 test cases enumerated in AC-8b must all be present and execute at least one assertion each. Hook reads stdin via readline+timeout pattern matching bash-guard.js:456-466; deny envelope matches bash-guard.js:16-26 shape; fail-open on timeout/crash. Bypass evaluated before stdin parsing.

- [ ] 10. Register hook in `hooks/hooks.json` (`hooks/hooks.json`) (wave: 3)
  Depends: 9
  Intent: Activate the hook in the Claude Code runtime so it fires on every Write, Edit, and MultiEdit PreToolUse event, matching the existing Write/Edit matcher pattern at hooks.json:237-270 and including MultiEdit per researcher Q1.
  Verify: AC-10: `hooks/hooks.json` contains three new PreToolUse entries — matchers `"Write"`, `"Edit"`, and `"MultiEdit"` — all invoking `node "${CLAUDE_PLUGIN_ROOT}/hooks/tdd-guard.js"`; JSON is valid (`node -e "require('./hooks/hooks.json')"` exits 0).

- [ ] 11. ~~Add tdd-guard entry to `.pipeline/agent-roles.json`~~ — **DROPPED** per researcher Q3. Hook processes do not carry an `agent_type` in their stdin payload; `hooks/ctx-pre-tool.js:93-94` short-circuits when `agentType` is absent, so an agent-roles.json entry would have zero effect. See `docs/RESEARCH/tdd-guard-hook-unknowns.md` Q3.

### Research needed

(All resolved — see `docs/RESEARCH/tdd-guard-hook-unknowns.md` and the Resolution section below.)

### Resolution of plan-stage research findings

Researcher (`docs/RESEARCH/tdd-guard-hook-unknowns.md`) and gotcha-checker concur on three changes pinned into the plan body above:

1. **MultiEdit is a distinct PreToolUse event.** Task 10 AC-10 updated to require three matchers (`Write`, `Edit`, `MultiEdit`).
2. **Both Write and Edit use `tool_input.file_path`** (not `path`). Hook-contract section updated; coder should keep the defensive `file_path || path` fallback that `workflow-guard.js:191-194` uses.
3. **agent-roles.json entry is not required for hook processes.** Task 11 dropped (hooks have no `agent_type`; `ctx-pre-tool.js:93-94` short-circuits without one).

### Resolution of plan-stage reviewer verdicts

Plan-stage reviewers returned REVISE — `reviewer-boundary` 1 warning, `reviewer-logic` 1 blocker + 6 warnings. Verdict files: `.pipeline/context/reviewer-output/reviewer-boundary.md`, `.pipeline/context/reviewer-output/reviewer-logic.md`. Conductor decisions follow; implementer should treat these as authoritative AC supplements.

**reviewer-logic BLOCKER — Task 8 phase ordering:** Tests in the original Task 8 cannot fail meaningfully without an importable stub. Resolution applied: Task 8 split into **Task 8a** (create stub `hooks/tdd-guard.js` exporting `runGuard(payload, env)` returning `{exitCode: 0}` unconditionally) and **Task 8b** (write tests against the stub). Reviewer's recommended Option A.

**reviewer-logic warning — assertion-deletion in AC-9:** Resolution applied. AC-9 now explicitly forbids removing assertions, `.skip`-ing tests, or deleting test cases from Task 8b to satisfy the green-bar criterion. The 11 enumerated test cases must all be present.

**reviewer-logic warning — empty test file:** Resolution applied. Failure-mode table now has a row for "test file with zero executing tests"; behavior is fail-closed (block) with a specific deny message. AC-8b test case (3) covers this.

**reviewer-logic warning — test-file imports non-existent source:** Resolution applied. Decision tree now explicitly states this case is allowed (module-not-found ⇒ non-zero exit ⇒ valid red bar for first-write TDD). AC-8b test case (5) covers this.

**reviewer-logic warning — multiple test file matches:** Resolution applied. Test-file resolution order is now deterministic and documented (adjacent → `tests/` → `__tests__/`, first match wins).

**reviewer-logic warning — no semantic validation that failing test is about target:** Resolution applied. Documented as a known v1 limitation in the chosen-mechanism section; deny message will surface this so agents understand the contract. v2 could parse test names — out of scope for this run.

**reviewer-logic warning — bypass precedence:** Resolution applied. AC-9 specifies bypass is evaluated **before** stdin parsing so a malformed payload + bypass still allows. AC-8b test case (7) verifies this.

**reviewer-logic warning — line 105 stale text:** Already resolved in the prior research-findings pass; the hook-contract section now correctly states both Write and Edit use `file_path`. No further action needed.

**reviewer-boundary warning — source-file detection scope vs `workflow-guard.js`:** `workflow-guard.js:14-31` excludes `/hooks/`, `/bin/`, `/mcp/` from its `isSourceFile` check because that hook gates **end-of-pipeline workflow steps** (apply-stage commit signals), not TDD coverage. `tdd-guard.js` operates at a different boundary — it gates *every* Write/Edit on plugin source code regardless of pipeline stage. The two scopes are intentionally disjoint and serve different policies. Resolution applied: noted here. Implementer must include a comment in `tdd-guard.js` explaining the deliberate scope difference so future readers don't try to "reconcile" the two scope rules.

These resolutions are authoritative; implementer must reference them when there's ambiguity.

### Approach summary
- Decision: Hook-enforced TDD guard (research §6.1 pattern) using `node --test <test-file>` to confirm a failing test exists before allowing source-file writes; fail-open on timeout/crash; `TDD_GUARD_BYPASS=1` env var for session opt-out.
- Trade-off: Spawning a node subprocess per Write/Edit/MultiEdit adds ~100–300 ms latency to every source-file write; acceptable given the <500 ms budget, but will be noticeable in tight edit loops.
- Uncertainty: All three plan-stage unknowns resolved (MultiEdit distinct, both tools use `file_path`, no agent-roles.json entry needed).

---

### Feature: reviewer-tests agent

Summary: Add a diff-aware `reviewer-tests` agent that BLOCKs handoffs containing test-weakening patterns, closes board TODO `48bddb1b`.

#### Goal

`reviewer-tests` is a post-coder reviewer that reads the git diff and blocks merge of any handoff that weakens the test suite. It catches four categories: (1) deleted or loosened assertions, (2) new mocks of production paths, (3) added lint/type-check disable comments, (4) added or expanded skip/xfail markers. It runs in the implement pipeline in parallel with other reviewers whenever a handoff touches test files or adds suppression keywords. The agent itself is built test-first per FORGE TDD discipline.

#### Acceptance criteria

- AC-1: Given a diff deleting an `expect(...)` or `assert(...)` line in a test file, reviewer-tests outputs `verdict: BLOCK` with file:line citation.
- AC-2: Given a diff that renames a test function such that its name no longer reflects the original coverage intent (e.g. `test_foo` → `test_placeholder`), reviewer-tests outputs `verdict: BLOCK` or `REVISE`.
- AC-3: Given a diff adding `jest.mock(`, `vi.mock(`, `sinon.stub(`, `unittest.mock.patch` wrapping a production module that was previously called directly, reviewer-tests outputs `verdict: BLOCK` with citation.
- AC-4: Given a diff adding `// eslint-disable`, `/* eslint-disable`, `# noqa`, `@ts-ignore`, `@ts-expect-error`, or `# type: ignore` near changed lines, reviewer-tests outputs `verdict: BLOCK` or `REVISE` with file:line citation.
- AC-5: Given a diff adding `it.skip(`, `describe.skip(`, `xit(`, `xdescribe(`, `test.skip(`, `@pytest.mark.skip`, `@pytest.mark.xfail`, or `t.Skip()`, reviewer-tests outputs `verdict: BLOCK` with citation.
- AC-6: Given a clean diff with no test weakening patterns, reviewer-tests outputs `verdict: APPROVED`.
- AC-7: `reviewer-tests` is dispatched by `scripts/reviewer-dispatch.mjs` when: (a) any `+++ b/` path in the diff matches `*.test.*`, `*_test.*`, `*spec*`, or `tests/**`; or (b) diff content contains `skip`, `mock`, `eslint-disable`, `noqa`, `@ts-ignore` keywords.
- AC-8: `agents/reviewer-tests.md` exists with correct FORGE frontmatter (name, description, model, tools, maxTurns, effort, memory, skills) and a `## Permissions` section with Always/Ask First/Never sub-headings per GENERAL.md schema.
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
| Test rename without coverage | test fn name changed but body gutted (removed assertions) | BLOCK |
| New mock of production path | `+.*\b(jest\.mock|vi\.mock|sinon\.stub|unittest\.mock\.patch|patch\s*\()` | BLOCK |
| Lint/type disable | `+.*\b(eslint-disable|noqa|@ts-ignore|@ts-expect-error|type:\s*ignore)` | REVISE (BLOCK if on assertion line) |
| Skip/xfail marker | `+.*\b(it\.skip|describe\.skip|xit\b|xdescribe|test\.skip|@pytest\.mark\.(skip|xfail)|t\.Skip\(\))` | BLOCK |

---

#### Phase 1 — Failing tests (TDD wave 1 — red bar)

- [ ] 1. Write failing tests for reviewer-tests dispatch routing (`scripts/reviewer-tests-dispatch.test.mjs`) (wave: 1)
  Intent: Establish the red bar for the dispatch-routing changes — tests must fail because `reviewer-tests` is not yet in the dispatch map, confirming TDD wave separation per research §3.2.
  Verify: AC-1 (partial): `node --test scripts/reviewer-tests-dispatch.test.mjs` exits non-zero; test cases cover: (a) diff touching `foo.test.js` dispatches `reviewer-tests`; (b) diff with `it.skip(` keyword dispatches `reviewer-tests`; (c) diff with `eslint-disable` keyword dispatches `reviewer-tests`; (d) clean diff with no test files and no keywords does NOT dispatch `reviewer-tests`; (e) `reviewer-tests` appears in the dispatch output alongside other triggered reviewers (not instead of them). Each case has at least one assertion; no `.skip` markers.

#### Phase 2 — Implementation (TDD wave 2 — green bar)

- [ ] 2. Create `agents/reviewer-tests.md` (`agents/reviewer-tests.md`) (wave: 2)
  Intent: Provide the agent definition so the pipeline can dispatch it; the agent reads the git diff and emits a structured verdict covering all four detection categories.
  Verify: AC-8: File exists with valid YAML frontmatter (name, description, model, tools, maxTurns, effort, memory, skills fields) and a `## Permissions` section with `### Always`, `### Ask First`, `### Never` sub-headings. Agent reads `docs/context/git-diff.txt`, scans for the six pattern categories in the detection table, emits verdict to `<outputDir>/reviewer-tests.md`, then emits `[reviewer-verdict]` signal. Plan-stage detection block present (mirrors other reviewers).

- [ ] 3. Add `reviewer-tests` to dispatch map in `scripts/reviewer-dispatch.mjs` (`scripts/reviewer-dispatch.mjs`) (wave: 2)
  Intent: Make `reviewer-tests` discoverable so it is automatically included when test files or suppression keywords are present in a handoff diff.
  Verify: AC-7 and AC-10: `node --test scripts/reviewer-tests-dispatch.test.mjs` exits 0 after this change; test cases (a)–(e) from Task 1 all pass. Dispatch logic adds `reviewer-tests` when: a `+++ b/` path matches test-file patterns (`*.test.*`, `*_test.*`, `*spec*`, `tests/**`), or diff content contains `skip`, `mock`, `eslint-disable`, `noqa`, `@ts-ignore` keywords.
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

- Exact regex for detecting "assertion loosening" (e.g. expected value changed to wildcard `.*` or `any()`) vs legitimate tolerance adjustments — boundary is fuzzy; researcher should check if existing reviewer-logic or tdd-agentic-llm-setups.md §3.4 gives more precise heuristics.
- Whether `scripts/verify-output.test.mjs` (existing test file) covers any reviewer-output format checks that `reviewer-tests.md` output must satisfy — if so, Task 2 coder must conform to that schema.

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
