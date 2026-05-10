## Boundary Review: Add impact-mapped test traceability via @covers tags (Phase 1 — Red Bar)

### Context

This is a **Phase 1 (TDD wave 1 — red-bar)** review of the test-author deliverable. The test-author agent created three failing test files + handoff based on the **resolved plan** (PLAN.md lines 75–96 pinned all plan-stage reviewer violations with authoritative resolutions). The source implementation modules (`covers-parser.mjs`, `covers-map.mjs`, `covers-verify.mjs`) do not yet exist — their absence is intentional and produces the expected red bar (7 tests, 0 pass, 7 fail).

### Violations

- [x] None identified.

### Verified

- [x] **Plan resolutions applied** — Handoff reflects all plan-stage boundary reviewer resolutions:
  - AC-1 (lines 9–10): Normalization assertions (d) leading `./` stripped, (e) backslashes normalized ✓
  - AC-3 (lines 186–193): Sub-assertions on parser→map→lookup flow (parser sees @covers, map keys canonical, lookup returns test path) ✓
  - AC-6 (per handoff notes): Verifier uses `extractSection` + `extractCodeBlockContent` from `handoff-utils.mjs`, NOT private `extractFilePaths` ✓
  - AC-9 (per handoff notes): No agent-roles.json modification; covers-verify runs as Bash subprocess ✓
  - AC-7 (per handoff notes): `[covers]` is diagnostic stderr output, NOT a registered signal ✓

- [x] **Architecture boundaries** — All test files use standard Node.js APIs (node:test, node:fs, node:path, node:child_process). No cross-layer dependencies or forbidden reaches.

- [x] **Module imports** — Test files import future modules by correct canonical paths:
  - `covers-parser-test.mjs` imports `./covers-parser.mjs` (line 18)
  - `covers-map-test.mjs` imports `./covers-map.mjs` (line 18)
  - `covers-verify-test.mjs` resolves `./covers-verify.mjs` via spawnSync (lines 34–36)

- [x] **Contract completeness** — Function signatures match resolved plan:
  - `parseCovers(content: string) → { covered: string[] }` ✓
  - `buildCoversMap(root: string) → Promise<object>` ✓
  - `covers-verify.mjs` CLI with `--handoff=`, `--root=`, optional `--strict-gaps` flags ✓

- [x] **Type correctness** — No `any` types. All assertions use explicit shapes (objects, arrays, strings, numbers). Test helpers define clear return shapes (lines 72–77, 250–254).

- [x] **AC-1 assertions** — All five cases present:
  - (a) Single @covers line (line 20–24)
  - (b) No @covers returns empty array (line 26–30)
  - (c) Multiple @covers lines collected (line 32–47)
  - (d) Leading `./` stripped (line 49–53) ✓ per resolution
  - (e) Backslash normalization (line 55–59) ✓ per resolution

- [x] **AC-2 assertions** — Both cases present:
  - (a) Two fixture test files produce correct `srcFile → [testFile]` map with canonical forward-slash keys (line 32–84)
  - (b) Test file with no @covers contributes no entries (line 86–102)

- [x] **AC-3 assertions** — All four cases with sub-assertions:
  - (a) Parser→map→lookup flow with sub-assertions: parser sees @covers (line 140), map keys canonical (line 145–146), lookup returns test path (line 150–154) ✓ per resolution
  - (b) Uncovered file emits `[covers-gap]` on stderr with file name (line 180–186)
  - (c) Failing test causes verifier exit non-zero (line 213)
  - (d) Batched subprocess isolation: independent pass/fail per file (line 221–264), no spurious `[covers-gap]` for covered files (line 257–260)

- [x] **No .skip markers** — All test functions active (no `.skip()` calls).

- [x] **No source implementation shipped** — Phase 1 scope respected. No `covers-parser.mjs`, `covers-map.mjs`, `covers-verify.mjs` files created. Red bar confirmed by missing module imports.

- [x] **Handoff format** — Standard structure: Summary, Files to create (with code blocks), Acceptance criteria (with AC status), Notes.

- [x] **TDD wave ordering** — Phase 1 is wave 1 (red bar). PLAN.md Phase 2 (wave 2) implements sources. Phase 3 (wave N) confirms regression suite green. Ordering is correct.

### Per-criterion verdicts

- `AC-1: MET` — All five test cases present including normalization (d, e) per plan resolution
- `AC-2: MET` — Both test cases present; canonical forward-slash validation included
- `AC-3: MET` — All four cases with sub-assertions on parser→map→lookup per plan resolution; gap definition as "file not in map" clarified
- `AC-4: SKIPPED` — Implementation phase (source code), not deliverable in Phase 1
- `AC-5: SKIPPED` — Implementation phase
- `AC-6: SKIPPED` — Implementation phase
- `AC-7: SKIPPED` — Implementation phase
- `AC-8: SKIPPED` — Implementation phase
- `AC-9: SKIPPED` — Implementation phase
- `AC-10: SKIPPED` — Implementation phase
- `AC-11: SKIPPED` — Regression phase (wave N)

### Verdict

**APPROVED** — All boundary checks pass. Test files are structurally sound, import future modules by correct canonical paths, contain all required assertions including plan-stage reviewer resolutions (normalization cases, sub-assertions on parser→map→lookup, batched subprocess isolation), include no `.skip` markers, and produce the expected red bar (7 tests, 0 pass, 7 fail). Handoff correctly reflects the resolved plan. Phase 1 scope is respected (test files only, no source implementation).

