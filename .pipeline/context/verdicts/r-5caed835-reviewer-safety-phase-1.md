## Safety Review: Add impact-mapped test traceability via @covers tags (Phase 1 — Red Bar)

### Issues
- [ ] None

### Verified
- [x] **Shell injection** — `covers-verify-test.mjs` uses `spawnSync(process.execPath, [VERIFIER, ...args], {...})` with **array form** (line 67–71); no string interpolation into shell command. Arguments constructed via `join()` and template literals, never shell-escaped. `process.execPath` is Node.js runtime path (safe).
- [x] **File system safety** — `covers-map-test.mjs` (lines 20–26) and `covers-verify-test.mjs` (lines 38–43) create isolated tmpdir fixture roots via `mkdtempSync(join(tmpdir(), 'covers-*-test-'))`. All file writes scoped to `join(root, relPath)`. Cleanup (`rmSync(root, { recursive: true, force: true })`) bounded to per-test fixture root; never touches repo root. `force: true` is safe for test-generated tmpdir.
- [x] **Path traversal** — Paths constructed exclusively with `path.join()` and `path.resolve()`, never string concatenation. Verifier test passes `--handoff=${join(root, 'docs/context/handoff.md')}` and `--root=${root}` — both remain under tmpdir. VERIFIER path resolved via `resolve(__dirname, 'covers-verify.mjs')` (repo-relative, safe).
- [x] **Secrets and credentials** — No API keys, tokens, or credentials hardcoded or written to files.
- [x] **Content injection** — Pure Node.js tests, no HTML rendering or DOM manipulation. Fixture content is internally generated with known safe values. Subprocess return assertions check text markers (`[covers-gap]`, `target-src-test`) in structured returns; no injection vectors.
- [x] **Input validation** — Test files accept no external input. Fixture data (source file content, handoff markdown) is generated internally with safe constants. Verifier subprocess returns parsed as `utf8` text without further processing beyond marker searches.
- [x] **TDD red-bar correctness** — Tests import non-existent modules (`covers-parser.mjs`, `covers-map.mjs`, `covers-verify.mjs` at lines 18, 90, 211). MODULE_NOT_FOUND causes test failures (exit 1), which is the intended red-bar signal. Helper `assertVerifierLoaded()` (line 260–265) confirms the verifier's absence produces the expected failure. Tests will pass once Phase 2 implementation provides the missing modules.
- [x] **@covers tag format** — Tests use `// @covers <repo-relative-path>` format (lines 17, 89, 211 in test files; lines 37–45, 108–117 in fixture content). Format is consistent and unambiguous; tags are passive metadata (never interpolated into subprocess calls or file operations).

### Per-criterion verdicts

Only AC-1, AC-2, AC-3 are in scope for Phase 1 (wave 1). AC-4 through AC-11 are Phase 2+ and out of scope.

- **AC-1: MET** — Test file `scripts/covers-parser-test.mjs` exists. All five sub-assertions present: (a) single @covers line, (b) no @covers tag returns empty array, (c) multiple lines collected, (d) leading `./` stripped, (e) Windows backslashes normalized to forward-slashes. Imports `parseCovers` which does not exist (MODULE_NOT_FOUND) — red bar confirmed.
- **AC-2: MET** — Test file `scripts/covers-map-test.mjs` exists. Both sub-assertions present: (a) two fixture test files produce correct `srcFile → [testFile]` map with canonical forward-slash keys (line 60 normalizes backslashes with `p.replace(/\\/g, '/')`), (b) test file with no @covers contributes no entries (line 98 asserts empty map). Imports `buildCoversMap` which does not exist — red bar confirmed.
- **AC-3: MET** — Test file `scripts/covers-verify-test.mjs` exists. All four sub-assertions present: (a) parser→map→lookup flow with sub-assertions on canonical paths (lines 123–158), (b) uncovered src file emits `[covers-gap]` on stderr (line 180–186), (c) failing covering test causes exit non-zero (line 213), (d) batched subprocess isolation with stderr distinction (lines 248–263). Imports `covers-verify.mjs` which does not exist; subprocess invocation with `--handoff` argument references a mock handoff — red bar confirmed.

### Verdict
**APPROVED** — No safety issues in Phase 1 deliverables. The three test files follow secure practices: tmpdir isolation with bounded cleanup, safe subprocess invocation (array form, no shell interpolation), path-safe construction (join/resolve), and no secrets/injection vectors. TDD red-bar discipline correctly enforced via MODULE_NOT_FOUND and assertion failures.

