## Logic Review: TDD Guard Hook

### Issues

- [ ] **Phase ordering: Task 8 tests require stub** — Lines 151, 158: Task 8 AC-8 requires `node --test hooks/tdd-guard.test.mjs` to "exit non-zero with the following test cases failing" immediately after Task 8. But the test file must import `hooks/tdd-guard.js` to unit-test the hook logic. If Task 9 (implementation) hasn't run yet, `require('hooks/tdd-guard.js')` fails and test file cannot even parse. Plan does not address: is there a stub created in Task 8? Or are tests written but not expected to run until Task 9? Or should tests mock the module? The red-bar requirement (exit non-zero) is unachievable without a stub or clarification. **Fix:** Task 8 should either (1) include a sub-step to create `hooks/tdd-guard.js` stub that exports a testable function, (2) state that tests are written but not run during wave 1, or (3) clarify how test file imports the hook when it doesn't exist.

- [ ] **Edge case: test file imports non-existent source file** — Lines 116-121: "Failing test exists" decision tree doesn't explicitly address: target `hooks/foo.js` doesn't exist yet (new module), test file exists at `tests/foo.test.js`, and test imports `require('hooks/foo.js')`. `node --test` exits non-zero (module-not-found error, non-zero exit code). Hook treats this as "failing test exists → allow write." Semantically correct for TDD red phase, but plan should confirm this is the intended behavior (vs. failing-closed or raising an error message about missing source file). Currently implicit and not documented in failure modes (lines 134-142).

- [ ] **Test file with no tests (empty file)** — Lines 134-142, 151: Test file exists but contains no executable tests (empty file or only helper functions). `node --test` exits 0 (no tests = success). Hook blocks the write. Plan does not explicitly document this scenario. Should clarify: is "no tests" treated as "all green" (block is correct), or should it fail-closed with a message directing agent to write tests? Current logic is correct and conservative, but AC-8 test case #7 (lines 151) should enumerate this.

- [ ] **No validation that failing test is about target module** — Lines 116-121: Hook looks for test file by filename mapping (`hooks/foo.js` → `tests/foo.test.js`), then checks `node --test` exit code. If test file contains an unrelated failing test (e.g., leftover broken test for a different module), hook allows write to `foo.js` even though the failing test has no connection to `foo.js`. The plan's test-presence check cannot distinguish "failing test is about target module" from "test file contains any failing test." This is a limitation of the file-path-based mapping approach vs. semantic test-code analysis. Plan should document or accept this as a known limitation (acceptable for v1, could be improved with test-name parsing in v2).

- [ ] **Multiple test file matches — no resolution order** — Lines 110-114: "for a target file `hooks/foo.js`, the hook looks for `hooks/foo.test.js` or `tests/foo.test.js` or `scripts/foo.test.mjs`." Plan does not specify: if multiple paths exist, which takes priority? Typical convention: one file per module, but plan should define deterministic behavior (e.g., "check in order: hooks/foo.test.js, then tests/foo.test.js, then scripts/foo.test.mjs; use first match").

- [ ] **AC-9 allows pathological passing tests** — Line 158: "All test cases from Task 8 pass" does not prevent implementer from deleting all assertions and marking tests as `.skip`. Tests would execute (exit 0), AC-9 passes, but hook enforces no TDD at all. **Recommend adding to AC-9:** "Test suite must include a minimum of N test cases per scenario (no test file exists, test file exists+all pass, test file exists+at least one fails); each test case includes at least one assertion that would fail if the hook logic is broken."

- [ ] **Plan line 105 contains stale/incorrect text** — Line 105: "Coder should still apply a defensive `tool_input.file_path || tool_input.path` extraction to match the existing pattern in `workflow-guard.js`. (See `docs/RESEARCH/tdd-guard-hook-unknowns.md` Q2.)" But line 105 also states "Edit uses `path`" — this is incorrect per research doc Q2 which confirms "Edit uses `file_path`" (not `path`). Edit the plan text at line 105 to remove the false claim, or keep only the defensive fallback comment.

### Verified

- [x] Bypass mechanism (`TDD_GUARD_BYPASS=1`) aligns with research doc §4.1 pattern and bash-guard.js precedent (env var check) — ✓
- [x] `node --test <test-file>` mechanism matches research doc §3.2 / §4.1 recommendation ("the harness, not the agent, runs the tests") — ✓
- [x] Fail-open on timeout/crash/ENOENT matches bash-guard.js:456-466 readline+timeout pattern — ✓
- [x] Deny envelope shape (JSON + stderr + exit 2) matches bash-guard.js:16-26 pattern — ✓
- [x] Three PreToolUse matchers (Write, Edit, MultiEdit) confirmed by research doc (tdd-guard-hook-unknowns.md Q1) — ✓
- [x] Both Write and Edit use `file_path` in tool_input confirmed by research doc (tdd-guard-hook-unknowns.md Q2) — ✓
- [x] agent-roles.json entry not required for hooks confirmed by research doc (tdd-guard-hook-unknowns.md Q3); Task 11 correctly dropped — ✓
- [x] Hook-enforced TDD pattern (lines 116-121) aligns with research doc §6.1 (github.com/nizos/tdd-guard) architecture — ✓
- [x] Red+Green collapse prevention (research §3.2) addressed by tdd-guard blocking writes until failing test is observed — ✓

### Per-criterion verdicts

- **AC-8:** MET — AC-8 specifies seven test cases (block when no test file, block when test passes, allow when test fails, allow on test files themselves, allow when TDD_GUARD_BYPASS=1, fail-open on timeout, fail-open on parse error). Once the phase-ordering issue (Task 8 stub) is resolved, these are measurable. BUT **conditional:** AC-8 text should explicitly enumerate the edge case of test file with no tests (empty file) as test case #8.

- **AC-9:** PARTIALLY_MET — AC-9 lists criteria (all tests pass, stdin pattern, deny envelope shape, fail-open) but the "all test cases pass" criterion is too weak (allows assertion deletion). Recommend tightening AC-9 as noted in Issues section.

- **AC-10:** MET — AC-10 specifies three matchers (Write, Edit, MultiEdit) and JSON validation. Clear and testable.

### Recommended plan edits (if REVISE / BLOCKED)

1. **Lines 147-151 (Phase ordering):** Insert a sub-step or clarification in Task 8:
   - Option A: "Task 8a: Create stub `hooks/tdd-guard.js` that exports a testable function (minimally: accept stdin, return exit code). Task 8b: Write failing tests that import the stub."
   - Option B: "Note: Test cases are written in this wave but *not* expected to pass until Task 9 implementation is complete. Tests will fail to parse/import in wave 1 because the module doesn't exist yet; this is expected and correct for TDD red-bar structure."
   - Recommend Option A (stub) for faster feedback loop.

2. **Line 105:** Remove or correct the claim about Edit using `path`. Current text:
   > "Coder should still apply a defensive `tool_input.file_path || tool_input.path` extraction to match the existing pattern in `workflow-guard.js`. (See `docs/RESEARCH/tdd-guard-hook-unknowns.md` Q2.)"
   
   Should be:
   > "Coder should apply a defensive `tool_input.file_path || toolInput.path` extraction (per `workflow-guard.js:191-194` pattern). Both Write and Edit use `file_path` as primary field (confirmed by research doc Q2); the `|| toolInput.path` fallback is for robustness only."

3. **Line 114, Task 10 AC-10:** Expand to enumerate the three matchers explicitly:
   > "AC-10: `hooks/hooks.json` contains three new PreToolUse entries matching: `"Write"`, `"Edit"`, and `"MultiEdit"` — all invoking `node "${CLAUDE_PLUGIN_ROOT}/hooks/tdd-guard.js"`; JSON validates (`node -e "require('./hooks/hooks.json')"` exits 0)."

4. **Line 151, Task 8 AC-8:** Add test case for empty test file:
   > "Verify: AC-8: `node --test hooks/tdd-guard.test.mjs` exits non-zero with test cases covering: (1) blocks Write when no test file exists; (2) blocks Write when test file exists but all tests pass (green); (3) blocks Write when test file exists but contains no tests (empty file); (4) allows Write when test file exists and at least one test fails (red); (5) allows Write on test files themselves; (6) allows Write when TDD_GUARD_BYPASS=1; (7) fail-open when node test runner times out; (8) fail-open on hook stdin parse error."

5. **Line 158, Task 9 AC-9:** Tighten to prevent assertion-deletion pathology:
   > "Verify: AC-9: All test cases from Task 8 pass (`node --test hooks/tdd-guard.test.mjs` exits 0); hook reads stdin via readline+timeout pattern matching bash-guard.js:456-466; deny envelope matches bash-guard.js:16-26 shape; fail-open on timeout/crash. Each test case includes at least one assertion that would fail if the hook exits 0 incorrectly or fails to read/parse stdin correctly. No assertions are deleted or marked `.skip` to achieve passing status."

6. **Lines 134-142 (Failure modes table):** Add row for empty test file:
   > "| Test file exists but is empty (no test definitions) | Block write — treated as 'all green', same as a file with only skipped tests. Correctly prevents writes when no red phase is observed. |"

### Verdict

REVISE — six issues identified, most are edge-case clarifications and one is a logical dependency (phase ordering) that requires a clarification or stub-creation step. The core logic is sound and aligned with research, but plan text needs tightening for implementer clarity.

- **Blockers:** 1 (phase-ordering Task 8 stub dependency must be resolved to satisfy red-bar requirement)
- **Warnings:** 6 (edge cases, AC criteria tightening, text corrections)
