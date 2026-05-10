## Safety Review: impact-mapped test traceability via @covers tags

### Issues
- [x] **No safety issues found**

### Verified
- [x] **Shell injection** — `covers-verify.mjs` line 124–126: `spawnSync(process.execPath, ['--test', ...testFiles], {...})` uses array args, not shell string interpolation. Test files come from impact-map parsing (handoff + glob results), no user-controlled input in subprocess args.
- [x] **Path traversal safety** — `covers-backfill.mjs` lines 118–129: `validateInferredPath()` checks `relative(rootDir, inferredAbs).startsWith('..')` to reject traversal, and `existsSync()` to reject non-existent files before writing. Code implements the plan's explicit example: `../../../etc-test.mjs` is rejected.
- [x] **Regex DoS** — `covers-parser.mjs` line 19: regex `/^\/\/\s*@covers\s+(.+)$/` is linear (no catastrophic backtracking); greedy `(.+)` is bounded by line end.
- [x] **Glob safety** — `covers-map.mjs` lines 19–23 and `covers-backfill.mjs` lines 42–46: glob patterns are hardcoded (`hooks/*-test.js`, `mcp/*-test.mjs`, `scripts/*-test.mjs`), never user-controlled. Patterns constrain to three directories only; no symlink traversal vectors.
- [x] **Subprocess timeout** — `covers-verify.mjs`: subprocess is `node --test` (Node's bounded test runner), not a shell `timeout`-less operation.
- [x] **NODE_TEST_CONTEXT handling** — `covers-verify.mjs` lines 122–123 correctly strip `NODE_TEST_CONTEXT` from child env so the subprocess doesn't inherit test-worker mode.
- [x] **Handoff file extraction** — `covers-verify.mjs` lines 50–68: uses exported `extractSection()` and `extractCodeBlockContent()` from `scripts/lib/handoff-utils.mjs` (per plan Resolution Option B). No private API coupling (does NOT import `extractFilePaths` from lean-risk-classify.mjs).
- [x] **File writes** — `covers-backfill.mjs` line 230: `writeFileSync(tf, tag + content, 'utf8')` prepends safely without path traversal; write happens only after validation at lines 118–129.
- [x] **Input validation** — All scripts validate args before use. `covers-verify.mjs` line 75 requires `--handoff=<path>`. Error handling via `process.stderr.write()` + `process.exit()`, not throws.
- [x] **Secrets/credentials** — No API keys, tokens, credentials in any script. CLI args contain only file paths and flags.
- [x] **Agent-roles.json not modified** — AC-9: `.pipeline/agent-roles.json` remains unchanged. `skills/implement/SKILL.md` step includes comment: `# covers-verify.mjs runs as a Bash subprocess, not a registered agent — no agent-roles.json entry needed.`
- [x] **Signal format** — AC-7: `[covers]` diagnostic line (line 108) and `[covers-gap]` lines (line 96) are stderr output only, not registered control signals. No SIGNAL-PROTOCOL.md update needed.
- [x] **.tddguardignore scope** — Lists only four implementation scripts; no broad allow patterns that weaken tdd-guard.
- [x] **Coder.md @covers instruction** — AC-8: Line 59 adds mandate: "Every new test file written must include at least one `// @covers <src-path>` comment at the top."

### Per-criterion verdicts

- `AC-1`: SKIPPED — test-only criterion, not in safety domain
- `AC-2`: SKIPPED — test-only criterion, not in safety domain
- `AC-3`: SKIPPED — test-only criterion, not in safety domain
- `AC-4`: SKIPPED — implementation of pure parser, not a safety criterion (no I/O or injection vector)
- `AC-5`: SKIPPED — map builder logic, not in safety domain (no write/exec/traversal)
- `AC-6`: MET — verifier reads handoff via exported API (handoff-utils), resolves covering tests, runs subprocess with array args (no injection), emits diagnostic output only, does not block pipeline on gaps or test failures
- `AC-7`: MET — diagnostic `[covers]` output to stderr; gaps do not block pipeline; test failures are logged but do not block at this step (reviewers see results in handoff)
- `AC-8`: MET — coder.md instructs new test files to include `// @covers` tag
- `AC-9`: MET — `.pipeline/agent-roles.json` unchanged; SKILL.md documents subprocess design choice
- `AC-10`: MET — backfill script validates inferred paths (rejects traversal, rejects non-existent files), refuses to write on multi-match or zero-match (emits diagnostic signals), implements path-traversal example check (`../../../etc-test.mjs` rejected)
- `AC-11`: SKIPPED — regression suite criterion, not in safety domain

### Verdict
**APPROVED** — no safety issues found. All four implementation scripts pass shell injection, path-traversal, regex-DoS, glob-safety, input-validation, and secrets checks. Subprocess invocation uses array args (no injection). File writes are validated before execution. Handoff extraction uses exported stable APIs. Diagnostic signals are correctly separated from control signals.
