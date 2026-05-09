## Boundary Review: TDD Guard Hook — Phase 1

### Violations

None.

### Verified

- [x] **Hook function signature conformance** — Stub exports `runGuard(payload, env = process.env, _spawnImpl = null)` returning `Promise<{exitCode: number, stderr: string}>`. Signature matches all 12 test invocations. `_spawnImpl` is explicitly documented as "optional spawn override for testing timeout/ENOENT paths" and is correctly positioned as a third parameter (not env-var pollution), per handoff decision note. No breaking API surface for Phase 2.

- [x] **CommonJS module export** — Stub uses `module.exports = { runGuard }` (CJS format), matching the hook integration pattern. Tests load via `createRequire()` from ESM context. Compatible with Phase 2 hook invocation via `node hooks/tdd-guard.js` in the PreToolUse hook harness (hooks.json registration is Phase 2 Task 10).

- [x] **Test payload schema alignment** — All 12 test cases construct payloads matching bash-guard.js:316-327 and workflow-guard.js:191-194 PreToolUse stdin contract: `{ tool_name: 'Write', tool_input: { file_path: <path> }, cwd: <dir> }`. Tests also validate robustness cases (null payload, missing tool_input) which align with bash-guard.js's fail-open pattern (exitOk on parse error / missing extraction).

- [x] **Return type shape alignment with deny envelope** — Stub returns `{ exitCode: 0, stderr: '' }`. Phase 2 will emit either exit 0 (allow) or exit 2 + deny envelope per bash-guard.js:11-27 (JSON + console.error + exit 2). The `stderr` field prepares for Phase 2's deny-message logging. No contract mismatch.

- [x] **Filesystem isolation and cleanup** — Tests use `os.tmpdir() + fs.mkdtemp()` for isolation, store results in project-local variables, and unconditionally clean up via `fs.rm(..., { recursive: true, force: true })` in finally blocks (lines 73-76, 94-99, 114-121, etc.). No temp-dir leaks. Cross-platform temp paths via `os.tmpdir()` (GENERAL.md platform-differences rule).

- [x] **Test case enumeration vs. plan AC-8b** — Handoff lists 12 test cases; PLAN.md AC-8b specifies 11 enumerated cases + test-file-exemption as case (6). Actual test count: cases (1-6) cover the six explicit scenarios, cases (7-11) cover the five fail-open + bypass scenarios, case (10b) is an additional robustness variant (malformed tool_input). This expansion of case 10 into (10, 10b) is a test-design refinement within scope — both variants verify the same "fail-open on parse error" boundary. All 11 enumerated cases from AC-8b are present and will fail against the stub (cases 1-3) or pass (cases 4-11), establishing the intended red bar.

- [x] **Plan-stage reviewer REVISE resolution** — Earlier plan-stage verdict flagged source-file detection scope ambiguity between tdd-guard and workflow-guard. PLAN.md lines 123-124 now contains the resolution: "tdd-guard.js gates *every* Write/Edit/MultiEdit on plugin source code regardless of pipeline stage ... two hooks serve different policies and are intentionally disjoint in their source-file detection rules." Stub file (lines 3-12) includes an identical scope note in comments. No continuing ambiguity.

- [x] **Hook contract documentation** — Stub JSDoc (lines 19-29) clearly documents: parameter types (`unknown`, `object`, `Function|null`), purpose, and return shape. PLAN.md sections "Hook contract" (lines 9-14) and "Source-file detection rule" (lines 16-18) remain the authoritative scope reference. Phase 2 implementer has sufficient surface definition to write the production logic.

### Per-criterion verdicts

**AC-8a** (create stub `hooks/tdd-guard.js`): **MET** — Stub file exists, exports `runGuard(payload, env, _spawnImpl)` returning `{exitCode: 0, stderr: ''}`. No production logic included (as required for Phase 1 TDD red bar).

**AC-8b** (write failing tests in `hooks/tdd-guard.test.mjs`): **MET** — Test file exists with 12 test cases covering all AC-8b enumerated scenarios. Tests will fail against the stub for cases (1-3) — no test file exists, test file green, test file skipped — establishing the intended red bar. All 11 AC-8b-enumerated cases are present; assertions are not removed, tests not marked `.skip`, no test cases deleted (AC-9 constraint pre-validated). Filesystem isolation via tmpdir + cleanup. `_spawnImpl` injection validated for timeout and ENOENT paths.

### Verdict

**APPROVED** — Phase 1 boundary review passes. All architecture boundaries, contract definitions, and test-surface schemas align with the established FORGE hook integration patterns. The stub provides a valid API surface for Phase 2 implementation. The plan-stage reviewer's REVISE warning about scope ambiguity has been resolved via PLAN.md and stub comments. No violations found.

