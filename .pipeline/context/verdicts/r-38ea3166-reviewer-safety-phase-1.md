# Safety Review: TDD Guard Hook (Phase 1)

## Issues
- [ ] None identified.

## Verified
- [x] **Shell injection** — No subprocess spawning in Phase 1 stub. Tests inject `_spawnImpl` as explicit third positional arg (not derivable from stdin/env); injection point is test-only and cannot be triggered from production.
- [x] **Secrets and credentials** — No API keys, tokens, or credentials hardcoded. `TDD_GUARD_BYPASS` env var is plaintext flag, not a secret. No credential leakage to disk or logs.
- [x] **Content injection** — Stub does not parse, render, or process payload content. Tests construct synthetic payloads within `os.tmpdir()` isolation. No user-supplied content reaches markup or display surfaces. No INJECTION-WARNING markers found in project research files.
- [x] **File system safety** — All test writes scoped to `os.tmpdir()` via `mkdtemp(path.join(os.tmpdir(), 'tdd-guard-test-'))`. Zero project-root writes. All cleanup via `fs.rm(dir, { recursive: true, force: true })` in try/finally blocks (tests 1–9, 11; tests 10, 10b create no temp dirs). Path construction uses `path.join()` — no traversal risk. All test files remain isolated outside project tree.
- [x] **Input validation** — Stub accepts unknown payload, env object, optional _spawnImpl function. Tests pass null, empty object, and missing tool_input — stub correctly returns `{exitCode: 0}` for all cases. No dynamic code execution on external data. Payload parsing deferred to Phase 2.
- [x] **Trust boundary (test API)** — `_spawnImpl` is explicit third positional arg, not env-var or property. Cannot be supplied from PreToolUse JSON stdin. Tests use injection only for timeout/ENOENT simulation (cases 9, 11). No side-channel to production code path.
- [x] **Env-var naming and collision** — `TDD_GUARD_BYPASS` checked against `hook-utils.js`, `bash-guard.js`, and active hooks. No collision found. Does not conflict with existing FORGE env vars (FORGE_*, CLAUDE_*). Naming follows session-toggle pattern from research doc.
- [x] **Test file leakage** — `makeTempProject()` uses `os.tmpdir()` isolation; `removeTempProject()` called in try/finally in all 11 cases (tests 10/10b have no temp dir, no cleanup needed). All created files destroyed on test completion. Zero test artifacts left behind on test runner exit or test failure.

## Per-criterion verdicts

- AC-8a: MET — `hooks/tdd-guard.js` exists, exports `runGuard(payload, env, _spawnImpl)` returning `{exitCode: 0, stderr: ''}`, stub body unconditional.
- AC-8b: MET — `hooks/tdd-guard.test.mjs` contains 12 test cases (test cases 1–11, plus 10b variant). Test cases 1–3 expected to fail against stub (red bar); test cases 4–11 expected to pass. Each test uses proper cleanup and isolation. All assertions present and unchanged.

## Verdict
APPROVED — no safety issues found. Phase 1 stub and test suite are well-isolated, properly cleaned up, and introduce zero production risk. All file-system operations, input handling, and process-spawning safety concerns are correctly scoped to Phase 2 implementation.
