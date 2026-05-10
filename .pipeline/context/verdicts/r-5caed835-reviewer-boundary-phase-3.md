## Boundary Review: Add impact-mapped test traceability via @covers tags — Phase 3 (Regression)

### Context

This is a **Phase 3 (TDD wave N — regression verification)** review of the feature implementation. Phase 3 is verification-only: no source code is created or modified. The diff contains:
- `docs/context/handoff.md` — appended `## Phase 3 — Regression results (AC-11)` section
- `.pipeline/context/phase-3-status.json` (untracked) — structured AC-11 results summary
- `.pipeline/context/phase-3-run-tests.txt` (untracked) — captured test stdout/stderr

**AC-11 acceptance criterion:** Confirm all three new test files pass and the existing regression suite remains green (or pre-existing issues are correctly attributed to baseline).

### Violations

- [x] None identified

### Verified

- [x] **AC-11 Part 1 — Feature tests green bar verified:** The command `node --test scripts/covers-parser-test.mjs scripts/covers-map-test.mjs scripts/covers-verify-test.mjs` produced **12 tests, 12 passed, 0 failed, exit 0**. All three new test files (covers-parser-test, covers-map-test, covers-verify-test) pass. Feature-specific TDD cycle is complete.

- [x] **AC-11 Part 2 — Full regression suite baseline failures pre-existing:** The command `node scripts/run-tests.mjs` produced **22 passed, 14 failed, exit 1**. All 14 failures are `ERR_MODULE_NOT_FOUND` errors for `zod` (imported from `packages/forge-core/src/runs/schemas.js`) or `@modelcontextprotocol/sdk` (in `mcp/node_modules`). Workspace/package resolution issues — not caused by this feature.

- [x] **AC-11 Part 2 — Failing tests unrelated to feature diff:** The failing test files are:
  - `hooks/apply-context-inject-test.js` (zod error)
  - `hooks/ctx-session-start-terminal-cleanup-test.js` (zod error)
  - `mcp/apply-guard-test.mjs` (zod error)
  - `mcp/canUseTool-return-test.mjs` (zod error)
  - `mcp/dashboard-state-shape-test.mjs` (@modelcontextprotocol/sdk error)
  - `mcp/forge-list-runs-filter-test.mjs` (@modelcontextprotocol/sdk error)
  - `mcp/forge-read-board-filter-test.mjs` (@modelcontextprotocol/sdk error)
  - `mcp/gate-pending-guard-test.mjs` (@modelcontextprotocol/sdk error)
  - `mcp/per-run-state-lifecycle-test.mjs` (@modelcontextprotocol/sdk error)
  - `mcp/resume-terminal-suppression-test.mjs` (@modelcontextprotocol/sdk error)
  - `mcp/run-active-helpers-test.mjs` (zod error)
  - `mcp/runid-schema-test.mjs` (@modelcontextprotocol/sdk error)
  - `mcp/update-run-merge-test.mjs` (zod error)
  - `scripts/dashboard-server-runid-test.mjs` (zod error)

  **None of these files appear in the Phase 2 feature diff** (which only adds scripts/covers-*.mjs, .tddguardignore, and modifies agents/coder.md + skills/implement/SKILL.md). These failures are baseline regressions from the workspace, not regressions caused by this feature.

- [x] **Feature diff scope correct:** The Phase 3 handoff append accurately characterizes the regression state: Part 1 (feature tests) PASS, Part 2 (full suite) FAIL with correct attribution to pre-existing zod-resolution issues. No source-behavior changes shipped in Phase 3 (verification-only).

- [x] **Handoff AC-11 section accuracy:** The appended section correctly states:
  - AC-11 part 1: PASS (12/12 tests)
  - AC-11 part 2: FAIL (22/36 passed) with pre-existing baseline attribution
  - Root cause: ERR_MODULE_NOT_FOUND for zod/@modelcontextprotocol/sdk
  - Recommendation: surface as non-blocking warning at Gate #2; pre-existing issue out of scope

- [x] **No silent regression:** The feature introduces zero regressions in previously-passing tests. The 14 failing tests fail due to missing workspace dependencies, not changes in this feature's scope (covers tagging infrastructure, coder.md obligation, SKILL.md wiring).

### Per-criterion verdicts

- **AC-11: MET** — Part 1 (feature tests: `node --test scripts/covers-parser-test.mjs scripts/covers-map-test.mjs scripts/covers-verify-test.mjs`) exits 0 with 12 tests passing. Part 2 (full regression: `node scripts/run-tests.mjs`) exits 1 with 22/36 passing; all 14 failures are pre-existing baseline issues (ERR_MODULE_NOT_FOUND for zod or @modelcontextprotocol/sdk in unmodified test files). Feature introduces no regressions in previously-passing tests.

### Verdict

**APPROVED** — Phase 3 verification is complete and correct. The three new test files all pass (12/12), confirming the TDD green bar is achieved. The 14 failures in the full regression suite are pre-existing baseline issues from workspace dependency resolution (`zod`, `@modelcontextprotocol/sdk`), unrelated to this feature's scope. The handoff correctly attributes these failures and recommends a non-blocking warning at Gate #2. The feature introduces zero regressions in previously-passing tests.
