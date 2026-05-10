## Boundary Review: conductor-managed dispatch context for in-session subagent attribution

### Phase Summary
This review covers **Phase 1 (TDD wave 1 red bar)**: test file `hooks/dispatch-context-test.js` only.

### Violations
None — the test file respects all architecture boundaries.

### Verified — Phase 1 Test File

- [x] **Hook test pattern compliance** — `hooks/dispatch-context-test.js` follows established conventions (`hooks/resolve-runid-test.js`, `hooks/hook-utils-test.js`, `hooks/gate-sync-test.js`): shebang `#!/usr/bin/env node`, strict mode, commonjs require-based imports, `node:test` / `node:assert/strict`, async helper setup/cleanup with mkdtempSync/rmSync, fail-open error handling. Auto-discoverable by `scripts/run-tests.mjs` via `*-test.js` suffix.

- [x] **No boundary violations** — All test operations are confined to temp directories via `mkdtempSync` (line 55, 82, 109, etc.). No writes outside `.pipeline/` temp scope. No global state mutations. No files created in source tree.

- [x] **AC criterion mapping** — Test cases clearly guard AC-1 through AC-5 per PLAN.md Phase 1 (comment header lines 4–14):
  - AC-1a (valid dispatch-context): line 62–83
  - AC-1b (invalid runId format): line 89–110
  - AC-1c (file absent): line 116–132
  - AC-1d (stale cleanup): line 138–180 (includes fresh case line 182–203)
  - AC-1e (subagent-start swap): line 219–245 and 247–270
  Priority tests (env var wins, worktree-path wins): line 268–318

- [x] **Test contract assumptions** — Test assumes:
  - `utils.resolveRunId(projectDir, payload)` exists in hook-utils.js (already exported, lines 290–311)
  - `cleanupStaleDispatchContext(projectDir)` exported from ctx-session-start.js (AC-4, line 156)
  - Dispatch-context.json schema: `{runId: string, createdAt: ISO timestamp string}`
  - RUN_ID_RE pattern: `^r-[a-zA-Z0-9]+$` (same as hook-utils.js:263)
  - Stale threshold: >5 minutes (line 135, 143)

- [x] **Type correctness** — All assertions use strict comparison (`assert.equal`, `assert.ok`, `assert.match`, `assert.doesNotMatch`, `assert.doesNotReject`). No `any` types. Test seed function returns JSON objects with typed fields. `createdAt` is `new Date().toISOString()` (string). All inputs validated via constructor calls or explicit checks.

- [x] **Fail-open semantics** — Test at line 205–221 validates absent dispatch-context "is a no-op (never throws)" — matches GENERAL.md fail-open discipline. Test mocking stderr (line 162–164) confirms error message format without relying on throw/catch.

- [x] **No console.log pollution** — Test uses only `assert.*` methods and deliberate stderr mocking for verification (line 162–164). No logging left in test code. No commented-out code.

### Per-criterion verdicts (Phase 1 red bar only)

- `AC-1: MET` — Test file implements all five sub-criteria:
  - (a) line 62–83: valid dispatch-context file returns runId via 4th path
  - (b) line 89–110: invalid runId format falls through to findActiveRun
  - (c) line 116–132: file absent falls through to findActiveRun
  - (d) line 138–180: stale file (>5 min) is deleted with stderr message
  - (e) line 219–245 + 247–270: subagent-start.js static check + integration test
  No `.skip` markers. Test expects exit non-zero (red bar).

- `AC-2: SKIPPED` — AC-2 is implementation task (Phase 2, task 2); test verifies postcondition but code change is future.

- `AC-3: SKIPPED` — AC-3 is implementation task (Phase 2, task 3); test verifies postcondition (line 227–237 static check) but code change is future.

- `AC-4: MET` — Test at line 148–180 explicitly requires `cleanupStaleDispatchContext` export from ctx-session-start.js; mocks stderr to verify `[forge-dispatch-ctx] stale dispatch-context deleted` message; verifies stale file deletion and absent-file no-op. Testability export required.

- `AC-5: SKIPPED` — AC-5 is wiring (Phase 2, task 5, skills/explore/SKILL.md); not applicable to Phase 1.

- `AC-6: SKIPPED` — AC-6 is wiring (Phase 2, task 6, skills/plan/SKILL.md); not applicable to Phase 1.

- `AC-7: SKIPPED` — AC-7 is regression (Phase 3, task 7); applies after full implementation.

### Wiring gaps (Phase 1)

Minor: Test at line 156 requires `cleanupStaleDispatchContext` as an export from `ctx-session-start.js`, but the handoff does not explicitly list this function in Phase 2 task 4. This is a testability-driven export (AC-4) and correct to require, but implementer should confirm the export is added during Phase 2 when ctx-session-start.js is modified.

### Verdict

**APPROVED** — Phase 1 red-bar test file is well-formed, respects all architecture boundaries, maps cleanly to AC-1, AC-4 criteria, and correctly assumes the postconditions that Phase 2 implementation will satisfy. No violations, no architecture breaches, no unexposed internals beyond testability requirement (cleanupStaleDispatchContext export).
