## Boundary Review: Add impact-mapped test traceability via @covers tags — Phase 2

### Violations
- [x] None

### Verified
- [x] **AC-6 / Resolution violation 1 — extractFilePaths API boundary:** covers-verify.mjs imports `extractSection` and `extractCodeBlockContent` from `scripts/lib/handoff-utils.mjs` (line 18). It does NOT import the private `extractFilePaths` from `scripts/lean-risk-classify.mjs`. The handoff confirms this design choice and the exported API is correctly referenced. Per Resolution Option B.
- [x] **AC-9 / Resolution violation 2 — agent-roles.json scope:** `.pipeline/agent-roles.json` is **unchanged** — no `covers-verify` entry added. `skills/implement/SKILL.md` line 231 contains the required comment: `# covers-verify.mjs runs as a Bash subprocess, not a registered agent — no agent-roles.json entry needed.` Per Resolution: Bash subprocess path chosen.
- [x] **AC-7 / Resolution violation 3 — [covers] signal format:** SIGNAL-PROTOCOL.md is **unchanged**. covers-verify.mjs line 108 emits `[covers] <N> tests resolved, <M> gaps` to stderr as diagnostic output only — never as a control signal. No registration in SIGNAL-PROTOCOL.md required. Per Resolution: diagnostic stderr output only.
- [x] **AC-4 / Resolution violation 4 — @covers path normalization:** covers-parser.mjs lines 23–26 contain the single normalization point: `p.replace(/\\/g, '/').replace(/\/+/g, '/')` (Windows backslashes to forward-slashes, collapse runs), then `if (p.startsWith('./')) { p = p.slice(2); }` (strip leading `./`). Normalization occurs once in the parser; covers-map.mjs and covers-verify.mjs consume the canonical paths without re-normalizing. Per Resolution: parser is the single normalization point.
- [x] **AC-8 — coder.md @covers obligation:** agents/coder.md line 59 contains the new `### Always` bullet: `Every new test file written must include at least one `// @covers <src-path>` comment at the top.` The bullet was added after the pre-flight self-check bullet (line 58) and before the `### Ask First` section (line 61). Existing coder prose above and below this bullet is **unchanged and un-restructured**.
- [x] **AC-9 comment placement:** The comment on SKILL.md line 231 is placed immediately after the covers-verify subprocess invocation block (lines 227–230), making the design choice explicit for future readers.
- [x] **.tddguardignore justification:** The file lists the four implementation scripts (`covers-parser.mjs`, `covers-map.mjs`, `covers-verify.mjs`, `covers-backfill.mjs`). The justification is grounded in tdd-guard.js `resolveTestFile` function (lines 96–107): it only recognises the `.test.mjs` convention (lines 101–106: `${name}.test.js`, `${name}.test.mjs`, etc.), not the project's `-test.mjs` convention. The Phase 1 red bar was verified in the handoff (`test-author-output.json`). This is the established tdd-guard exemption mechanism.
- [x] **API contracts — parseCovers:** covers-parser.mjs line 15 exports `parseCovers(content: string) → { covered: string[] }`. Signature matches AC-4 expectation; normalization applied per above.
- [x] **API contracts — buildCoversMap:** covers-map.mjs line 86 exports `async function buildCoversMap(rootDir) → Promise<Record<string, string[]>>`. Signature matches AC-5 expectation; globs three canonical patterns (lines 19–23); reads each via `parseCovers` (line 100); returns plain-object reverse map (lines 101–105).
- [x] **API contracts — covers-verify CLI:** covers-verify.mjs lines 23–38 parse `--handoff=<path>`, `--root=<path>`, `--strict-gaps` flags. Per AC-6, all three expected flags present.
- [x] **Subprocess isolation — NODE_TEST_CONTEXT stripping:** covers-verify.mjs lines 122–123 delete `NODE_TEST_CONTEXT` from child environment before spawning `node --test` (lines 124–128). Comments (lines 115–119) explain why: without stripping, child inherits `NODE_TEST_CONTEXT=child-v8` and suppresses exit-code propagation. This ensures test failures cause non-zero exit, per AC-6 requirement.
- [x] **covers-backfill safety — path-traversal validation:** covers-backfill.mjs lines 118–129 implement `validateInferredPath`: rejects paths that start with `..` (line 121) and checks file existence (line 125). The function validates *before* any write (line 217). Per AC-10 Resolution, path-traversal safety is enforced.
- [x] **covers-backfill multi-match handling:** lines 199–206 check for `candidates` array and emit `[covers-ambiguous]` to stderr with candidate list. `hasError` flag is set (line 205); loop continues without writing (line 206). Per AC-10 Resolution.
- [x] **covers-backfill zero-match handling:** lines 209–212 check for `none: true` and emit `[covers-no-source]` to stderr. `hasError` flag set (line 211); loop continues without writing (line 212). Per AC-10 Resolution.
- [x] **covers-backfill --dry-run mode:** lines 182–192 handle `--dry-run`: prints missing list (lines 186–190) and exits 0 (line 192) without writing any files. Per AC-10 expectation.
- [x] **SKILL.md post-coder step placement:** Step 2 (Coder) in SKILL.md lines 221–241. The new coverage-check step (lines 227–231) is placed after the coder writes handoff (line 227 condition) and before the post-coder verification step (line 233). Correct ordering per AC-7 plan.
- [x] **No SIGNAL-PROTOCOL.md modification:** A grep across the diff confirms SIGNAL-PROTOCOL.md is not in the changed files. Per Resolution: no control signal registration needed.
- [x] **Handoff contract completeness:** The handoff.md (lines 66–73) declares all six AC criteria MET. Coverage section (lines 6–19) defines the new files and their contracts. Modification section (lines 23–64) defines the two agent/skill changes. Verification section (line 76) confirms green bar.

### Per-criterion verdicts

- **AC-4: MET** — `parseCovers` implemented with leading `./` stripped and Windows backslashes normalised; handles zero, one, and many `@covers` lines per file.
- **AC-5: MET** — `buildCoversMap` globs the three canonical test patterns with Node 22/20 compatibility fallback; reads each via `parseCovers`; returns plain-object reverse map keyed by canonical forward-slash source paths; no I/O side effects beyond file reads.
- **AC-6: MET** — covers-verify reads handoff "Files modified" via `extractSection` + `extractCodeBlockContent` from `scripts/lib/handoff-utils.mjs`; implements all three CLI flags (`--handoff`, `--root`, `--strict-gaps`); strips `NODE_TEST_CONTEXT` for correct exit propagation; emits `[covers-gap]` to stderr; exits non-zero on test failures or `--strict-gaps` + gaps.
- **AC-7: MET** — SKILL.md post-coder coverage check step added (lines 227–231); runs after coder writes handoff, before reviewer dispatch; `[covers]` diagnostic on stderr only (not a control signal); gaps cause `## Covers gaps` section in handoff for reviewer visibility; non-zero exit does not block the pipeline.
- **AC-8: MET** — `agents/coder.md` line 59 contains the new `### Always` bullet under `## Permissions`: "Every new test file written must include at least one `// @covers <src-path>` comment at the top." Existing prose unchanged and un-restructured.
- **AC-9: MET** — `.pipeline/agent-roles.json` unchanged. SKILL.md line 231 contains the required comment: `# covers-verify.mjs runs as a Bash subprocess, not a registered agent — no agent-roles.json entry needed.`
- **AC-10: MET** — covers-backfill script implements `--dry-run` (prints missing list, exits 0 without writing); multi-match → `[covers-ambiguous]` + exit 1; zero-match → `[covers-no-source]` + exit 1 (non-dry-run); path-traversal or non-existent inferred path → `[covers-rejected]` + skip; files already containing `@covers` are skipped (line 177: `covered.length === 0` filter).

### Verdict
**APPROVED** — All boundary checks pass. Resolution decisions are correctly implemented:
- API contracts complete and properly scoped (no private imports, correct exports).
- Agent-roles.json unchanged; subprocess design choice documented in SKILL.md.
- Signal format diagnostic-only; SIGNAL-PROTOCOL.md unchanged.
- Path normalization single-point in parser; map and verifier consume canonical paths.
- Coder.md obligation added to `### Always` block without restructuring.
- .tddguardignore justified by tdd-guard's hook behaviour.
- covers-backfill safety constraints (path-traversal, multi-match, zero-match) implemented.
- Green bar verified (12 tests, all pass).
