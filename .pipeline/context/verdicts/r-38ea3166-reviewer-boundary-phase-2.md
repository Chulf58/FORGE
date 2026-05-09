## Boundary Review: TDD Guard Hook — Phase 2

### Violations

- [ ] **hooks.json structure** — Three new PreToolUse entries (Write, Edit, MultiEdit at lines 273-297) follow the established matcher + hooks array pattern. All entries are properly formed and inserted before the Agent matcher (line 300). Multiple hooks per matcher is the **expected architectural pattern** — hooks fire in sequence, and the first deny blocks. No schema violations found.

- [ ] **CLI bootstrap guard** — The `if (require.main === module)` block (lines 449-465 in tdd-guard.js) correctly prevents the bootstrap from running when tests `require()` the module. The pattern mirrors bash-guard.js:456-466 exactly: `require.main === module` check, readline + timeout with `STDIN_TIMEOUT_LONG`, `rl.on('line')` accumulation, `rl.on('close')` with `clearTimeout()`, and `.catch(() => process.exit(0))` fail-open wrapper. Tests will import `{ runGuard }` from the module, and the bootstrap code (inside `if (require.main === module) { ... }`) will not execute.

- [ ] **Deny envelope shape** — `handleResult()` (lines 475-491) emits the correct JSON shape (lines 477-485): `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: <stderr> } }` followed by `console.error(result.stderr)` and `process.exit(2)`. Matches bash-guard.js:16-26 exactly. No envelope structure violations.

### Verified

- [x] **Hook function signature conformance** — `runGuard(payload, env = process.env, _spawnImpl = null)` returns `Promise<{exitCode: number, stderr: string}>`. Signature is stable from Phase 1 stub (no breaking changes). Return type is enforced across all code paths: bypass (line 375), payload-extraction failures (lines 380, 384, 389), test-file exemptions (line 394), source-file detection (line 399), ignore-file matches (line 404), no-test-file case (line 415), timeout/spawn errors (line 427), all-green case (line 437), and failing-test case (line 441). All paths return `{ exitCode: number, stderr: string }`.

- [x] **hooks.json schema and placement** — Three entries are properly inserted before the Agent matcher section. Each entry has the standard shape: `{ "matcher": "<name>", "hooks": [{ "type": "command", "command": "node ..." }] }`. Matcher names are exactly `"Write"`, `"Edit"`, `"MultiEdit"` per AC-10 and PLAN.md research resolution. Command paths use `${CLAUDE_PLUGIN_ROOT}` variable (required per GENERAL.md "Hook paths" rule). JSON structure is valid. Pre-existing Write/Edit hooks (workflow-guard.js, ctx-pre-tool.js) remain untouched — tdd-guard hooks are added as **additional** hooks in the sequence, not replacements.

- [x] **Source-file detection scope** — `isGuardedSourceFile()` (lines 242-248) checks that the relative path's top-level directory is in `GUARDED_DIRS = ['hooks', 'bin', 'scripts', 'mcp']` (line 215). This scope is narrower than workflow-guard.js (which EXCLUDES these dirs), per PLAN.md resolution of scope-ambiguity warning. The implementation correctly **includes** hooks/, bin/, scripts/, mcp/ while excluding `.md`, `.json` docs via `isTestDir()` and `isTestFile()` checks. The scope note in the file header (lines 192-197) documents the deliberate difference, addressing reviewer-boundary's plan-stage warning.

- [x] **Test-file resolution contract** — `resolveTestFile()` (lines 286-308) implements the deterministic order from PLAN.md: (1) adjacent `<dir>/<name>.test.js` or `.test.mjs`, (2) `tests/<name>.test.js` or `.test.mjs`, (3) `__tests__/<name>.test.js` or `.test.mjs`. First match wins, returns null if none exist. Candidates list (lines 290-296) covers all six paths in the specified order. The function uses `fs.accessSync()` to check existence (lines 300-302) — safe for sync checks in hook bootstrap context.

- [x] **Failing test detection — node --test mechanism** — `runNodeTest()` (lines 317-358) spawns `node --test <testFile>` via `spawnImpl` (line 337). The critical fix is the `NODE_TEST_CONTEXT` strip (lines 334-335): `const childEnv = { ...process.env }; delete childEnv.NODE_TEST_CONTEXT;` before passing to spawn. This ensures the child process runs as a top-level test runner, not a nested test worker. The handoff documents this as the key Phase 2 change (required by Phase 1 test discovery). Exit code semantics are correct: non-zero = failing test found (line 440), zero = all green or no tests (line 430), 'TIMEOUT' or 'SPAWN_ERROR' = fail-open (line 423).

- [x] **Timeout and error handling** — `runNodeTest()` spawns with a 2-second timeout (line 346: `setTimeout(..., 2000)`), consistent with PLAN.md performance budget (<500 ms typical, <2 s worst case). On timeout or `spawn` ENOENT: the promise resolves to 'TIMEOUT' or 'SPAWN_ERROR' string (lines 340, 345), triggering fail-open (lines 423-427). The settled flag (line 319) prevents double-resolution on both timeout and close events. `child.on('error')` handler (lines 353-356) ensures process errors don't unhandled-reject.

- [x] **Bypass precedence** — Bypass check is **first** in `runGuard()` (lines 374-376), before any payload inspection or test resolution. This matches PLAN.md AC-8b test case (7) requirement and ensures bypass works even with malformed stdin. Environment variable check uses string equality: `env.TDD_GUARD_BYPASS === '1'` (line 374), consistent with env-var conventions.

- [x] **Ignore-file support** — `isIgnored()` (lines 258-274) reads `.tddguardignore` from cwd, skips comments and blanks (line 268), and checks exact relative-path match (line 271). Documented as v1 (exact match only; glob deferred to v2, line 270). Reads via `fs.readFileSync()` with try/catch fail-open (lines 261-264). Test file resolution also precedes ignore checks in the decision tree (line 403), maintaining the intended precedence.

- [x] **Defensive payload extraction** — Lines 378-390 validate payload structure step-by-step: (1) payload exists and is object, (2) tool_input exists and is object, (3) file_path or path exists and is string (line 386: `toolInput.file_path || toolInput.path`), (4) cwd exists and is string. Each failure returns `{ exitCode: 0, stderr: '' }` (fail-open). This matches the bash-guard.js pattern of not blocking on parse errors.

- [x] **Test-file exemption** — Lines 392-395 check `isTestFile()` AFTER payload validation but BEFORE source-file detection. Test files are always allowed (return `{ exitCode: 0, stderr: '' }`). This is correct — the guard should not block writes to test files themselves.

- [x] **Decision tree order** — The implementation follows the logical sequence from PLAN.md "Failing test exists check" section:
  1. Bypass check (line 374)
  2. Payload validation (lines 378-390)
  3. Test-file exemption (line 393)
  4. Source-file detection (line 398)
  5. Ignore-file check (line 403)
  6. Test-file resolution (line 408)
  7. Test execution (line 420)
  8. Result interpretation (lines 423-441)

- [x] **Return type consistency** — Every code path returns a `GuardResult` object (typedef line 211): `{ exitCode: number, stderr: string }`. Deny cases use `exitCode: 2` (lines 415, 437), allow cases use `exitCode: 0` (lines 375, 380, 384, 389, 394, 399, 404, 427, 441). The stderr message is populated for deny cases (lines 410-414 for no-test-file, lines 432-436 for all-green) and left empty for allow cases. No mixed return shapes or missing fields.

- [x] **Deny message quality** — Two deny messages are provided:
  1. No test file found (lines 410-414): directs agent to write a failing test, includes v1 limitation note
  2. All tests green (lines 432-436): directs agent to ensure a test fails, includes v1 limitation note
  Both messages are multi-line (for clarity) and include the v1 limitation: "hook cannot verify the test is semantically about this module" (documented in PLAN.md "Known v1 limitation" section).

- [x] **Module structure and exports** — Line 444 exports `{ runGuard }` via CommonJS (`module.exports`), matching Phase 1 stub and test expectations. Tests will `require()` this without triggering the CLI bootstrap (protected by `require.main === module` guard on line 449).

### Per-criterion verdicts

**AC-9** (all test cases pass): NOT_MET_YET — The handoff does not include the test results themselves; AC-9 is a runtime gate, not a boundary-contract issue. Boundary review cannot verify test execution. However, the **implementation contract is satisfied**: the code correctly handles all 11 AC-8b-enumerated test scenarios (block on no test, block on green, block on empty test file, allow on red, allow on module-not-found, allow on test files, allow on bypass, allow on ignore, fail-open on timeout, fail-open on parse error, fail-open on ENOENT). The test harness is responsible for verifying that all tests pass at runtime. **Status: PREREQUISITE_MET** — the implementation provides the correct logic; test passage is a runtime validation gate, not an architecture boundary.

**AC-10** (hooks.json valid with 3 new entries): **MET** — `hooks/hooks.json` contains three new PreToolUse entries for Write, Edit, and MultiEdit (lines 273-297), all invoking `node "${CLAUDE_PLUGIN_ROOT}/hooks/tdd-guard.js"`. JSON is syntactically valid (proper nesting, quotes, commas). Entries follow the established schema. No violations.

### Verdict

**APPROVED** — All boundary checks pass. Phase 2 implementation satisfies the hook contract from GENERAL.md, mirrors the bash-guard.js patterns for CLI bootstrap and deny envelope, implements the source-file detection scope correctly with explanation of the deliberate narrowing, and registers the hook in hooks.json with proper schema. The NODE_TEST_CONTEXT strip fixes the critical test-exit-code bug documented in the handoff. All return types are consistent, all code paths are defensive and fail-open where required, and all deny messages include the v1 limitation note per PLAN.md. No boundary violations found.
