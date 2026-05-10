## Active Plan

(Stale prior feature blocks removed by conductor at gate1 of r-5caed835. Already shipped today: TDD Guard Hook via merge 5072aad2; reviewer-tests agent via merge ab3b2213; test-author agent + pipeline split via merge 9ee4c8b9. The active plan below targets the impact-mapped test traceability feature — closes TODO `e3beee5b`.)

### Feature: impact-mapped test traceability via @covers tags

Summary: Every test file declares covered source files via `@covers`; post-handoff verification proves the specific tests for touched files pass, not just the full suite.

#### Phase 1 — Failing tests (TDD wave 1 — red bar)

- [ ] 1. Write failing tests for the `@covers` parser (`scripts/covers-parser-test.mjs`) (wave: 1)
  Intent: Establish a red bar for tag parsing before any implementation exists — prevents Red+Green collapse per research §3.2.
  Verify: AC-1: `node --test scripts/covers-parser-test.mjs` exits non-zero; test cases assert (a) a file with `// @covers scripts/lean-risk-classify.mjs` returns `{ covered: ['scripts/lean-risk-classify.mjs'] }`, (b) a file with no `@covers` tag returns `{ covered: [] }`, (c) multiple `@covers` lines in one file are all collected, (d) **normalization** — input `// @covers ./scripts/foo.mjs` returns `{ covered: ['scripts/foo.mjs'] }` (leading `./` stripped), (e) **path normalization** — Windows backslashes in input are normalized to forward-slashes (`// @covers scripts\\foo.mjs` returns `{ covered: ['scripts/foo.mjs'] }`). No `.skip` markers.

- [ ] 2. Write failing tests for the impact-map builder (`scripts/covers-map-test.mjs`) (wave: 1)
  Intent: Establish a red bar for the glob-to-map aggregation before any implementation exists.
  Verify: AC-2: `node --test scripts/covers-map-test.mjs` exits non-zero; test cases assert (a) given two fixture test files each declaring `@covers`, the map returns `srcFile → [testFile, …]` with correct entries (canonical forward-slash keys), (b) a test file declaring no `@covers` contributes no entries to the map. No `.skip` markers.

- [ ] 3. Write failing tests for the post-handoff coverage verifier (`scripts/covers-verify-test.mjs`) (wave: 1)
  Intent: Establish a red bar for the verifier logic before implementation — confirms the verifier reads handoff "Files modified", resolves covering tests, and reports missing coverage.
  Verify: AC-3: `node --test scripts/covers-verify-test.mjs` exits non-zero; test cases assert (a) **parser→map→lookup flow** — verifier resolves a touched src file's covering test via parser+map and triggers `node --test <testFile>` reporting PASS/FAIL (sub-assertions: parser sees the test file's @covers, map keys match, lookup returns the test path), (b) a touched src file that exists in **no test's @covers declarations** (i.e., no key in the map) emits a `[covers-gap]` line on stderr (this is the boundary case — gap = file not in map, not "file not in any test"), (c) a touched src file with a covering test that fails causes the verifier to exit non-zero, (d) **batched subprocess isolation** — multiple test files in one `node --test <a> <b>` invocation succeed/fail per file independently, with stdout/stderr separated from gap reporting. No `.skip` markers.

#### Phase 2 — Implementation (TDD wave 2 — green bar)

- [x] 4. Implement `@covers` tag parser (`scripts/covers-parser.mjs`) (wave: 2)
  Intent: Provide the pure function that extracts `@covers` declarations from a single test file's text so the map builder can aggregate without re-doing file I/O. Normalization is the parser's responsibility (strip `./`, convert backslashes to forward-slashes).
  Verify: AC-4: `node --test scripts/covers-parser-test.mjs` exits 0; parser accepts a file-content string, returns `{ covered: string[] }` with paths normalised to forward-slash repo-relative form (no leading `./`, no Windows backslashes); handles zero, one, and many `@covers` lines per file.
  Depends: 1

- [x] 5. Implement impact-map builder (`scripts/covers-map.mjs`) (wave: 2)
  Intent: Aggregate per-file parser output into the project-wide `srcFile → [testFile, …]` map so the verifier and other consumers have a single lookup.
  Verify: AC-5: `node --test scripts/covers-map-test.mjs` exits 0; builder globs `hooks/*-test.js`, `mcp/*-test.mjs`, `scripts/*-test.mjs`, reads each with the parser, returns a plain-object map keyed by canonical forward-slash source paths; no I/O side effects beyond file reads.
  Depends: 2, 4

- [ ] 6. Implement post-handoff coverage verifier (`scripts/covers-verify.mjs`) (wave: 2)
  Intent: Prove that tests covering the coder's touched files pass — moving the pipeline guarantee from "suite green" to "relevant tests green + no coverage gap".
  Verify: AC-6: `node --test scripts/covers-verify-test.mjs` exits 0; verifier reads handoff "Files modified" section by combining `extractSection('Files modified', handoffText)` and `extractCodeBlockContent(...)` from `scripts/lib/handoff-utils.mjs` (per Resolution Option B below — does NOT import `extractFilePaths` from lean-risk-classify.mjs which is a private function); resolves covering tests via the impact map; runs `node --test <file1> … <fileN>` (batched, single subprocess); emits `[covers-gap] <srcFile>` to stderr for any touched file with no `@covers` entry in the map; exits non-zero when any test fails or when `--strict-gaps` flag is passed and gaps exist.
  Depends: 3, 5

- [ ] 7. Wire verifier into `skills/implement/SKILL.md` post-coder step (`skills/implement/SKILL.md`) (wave: 2)
  Intent: Make impact-map verification a mandatory post-coder step in the implement pipeline so coverage gaps surface before reviewers see the handoff.
  Verify: AC-7: `skills/implement/SKILL.md` contains a step that runs `node scripts/covers-verify.mjs --handoff=docs/context/handoff.md` after the coder writes the handoff and before reviewer dispatch; the step logs `[covers] <N> tests resolved, <M> gaps` to stderr **as diagnostic output only — NOT a registered control signal** (no SIGNAL-PROTOCOL.md update needed; nothing consumes it programmatically); a gap does not block the pipeline but adds a `[covers-gap]` section to the handoff for reviewers.
  Depends: 6

- [ ] 8. Update coder agent instructions to declare `@covers` tags (`agents/coder.md`) (wave: 2)
  Intent: Ensure the coder adds `@covers` declarations when creating new test files, closing the coverage map going forward without requiring a backfill audit.
  Verify: AC-8: `agents/coder.md` contains a `### Always` bullet (under `## Permissions`) stating that every new test file written must include at least one `// @covers <src-path>` comment at the top; existing coder prose is not removed or restructured.
  Depends: 4

- [ ] 9. covers-verify.mjs runs as a Bash subprocess — no agent-roles.json edit (`skills/implement/SKILL.md` comment only) (wave: 2)
  Intent: Per Resolution below, the verifier runs as a Bash subprocess invoked by SKILL.md (not a registered agent), so no agent-roles entry is needed. Document this design choice in SKILL.md so future readers understand why agent-roles.json is unchanged.
  Verify: AC-9: `.pipeline/agent-roles.json` is **unchanged** by this feature (no `covers-verify` entry added). `skills/implement/SKILL.md` (in the new Step from Task 7) contains a one-line comment: `# covers-verify.mjs runs as a Bash subprocess, not a registered agent — no agent-roles.json entry needed.`
  Depends: 7

- [ ] 10. Write one-shot backfill script (`scripts/covers-backfill.mjs`) (wave: 2)
  Intent: Add `@covers` tags to all existing test files that currently lack them in a single operator-run pass, seeding the impact map without blocking the pipeline on a gradual rollout.
  Verify: AC-10: Running `node scripts/covers-backfill.mjs --dry-run` prints the list of test files missing `@covers` and exits 0 without writing; running without `--dry-run` prepends `// @covers <inferred-src>` to each file using the heuristic "strip `-test` suffix and match against existing source paths"; backfill does not modify files that already have `@covers`.
  **Multi-match / zero-match / safety constraints (per Resolution below):**
  - **Multi-match (e.g. `helper-test.mjs` could match `helper.mjs` AND `some-helper.mjs`):** backfill emits `[covers-ambiguous] <test-file>: candidates=[<paths>]` to stderr, does NOT write the annotation, exits non-zero. Operator must hand-edit ambiguous cases.
  - **Zero-match (no source file matches the stripped suffix):** backfill emits `[covers-no-source] <test-file>` to stderr, does NOT write the annotation, exits non-zero only if not in `--dry-run` mode.
  - **Path-traversal safety:** before writing any `@covers <inferred-src>` annotation, validate (a) the inferred path resolves under the project root (no `../` traversal), (b) the inferred file exists on disk. If either fails, emit `[covers-rejected] <test-file>: <reason>` to stderr and SKIP that file. A test file named `../../../etc-test.mjs` MUST NOT have `@covers ../../../etc` written to it.
  Depends: 4

#### Phase 3 — Regression (TDD wave N)

- [ ] 11. Full regression suite green after impact-map feature (`scripts/covers-parser-test.mjs`, `scripts/covers-map-test.mjs`, `scripts/covers-verify-test.mjs`) (wave: 3)
  Depends: 7, 8, 9, 10
  Intent: Confirm all three new test files pass and the existing suite (`node scripts/run-tests.mjs`) remains green — no regressions from new scripts or agent/skill edits.
  Verify: AC-11: `node --test scripts/covers-parser-test.mjs && node --test scripts/covers-map-test.mjs && node --test scripts/covers-verify-test.mjs` all exit 0; then `node scripts/run-tests.mjs` exits 0 with no skipped or deleted cases.

### Research needed

(None — all design decisions made from codebase evidence and pinned in Resolution section below. Key findings: `extractFilePaths` in `scripts/lean-risk-classify.mjs` is PRIVATE; the verifier uses `extractSection` + `extractCodeBlockContent` from `scripts/lib/handoff-utils.mjs` instead. `scripts/run-tests.mjs` uses `node <path>` not `node --test`. Backfill is recommended as a one-shot script rather than enforced going-forward only, because the impact map has zero entries until existing test files are tagged.)

### Resolution of plan-stage reviewer verdicts

Plan-stage reviewers ran against this feature: `reviewer-performance` APPROVED (0/0); `reviewer-boundary` REVISE (0 BLOCKers, 4 violations); `reviewer-logic` REVISE (0 BLOCKers, 3 issues); `reviewer-safety` REVISE (0 BLOCKers, 1 issue). No BLOCKERs — gate1 proceeds with the following spec-precision clarifications pinned into the plan body:

**reviewer-boundary violation 1 — extractFilePaths API contract (CRITICAL):** Resolution applied — **Option B chosen**. The verifier (Task 6) reads handoff "Files modified" by combining `extractSection('Files modified', handoffText)` + `extractCodeBlockContent(...)` from `scripts/lib/handoff-utils.mjs` (the existing exported API used by lean-risk-classify.mjs internally). It does NOT import `extractFilePaths` from lean-risk-classify.mjs (which is a private function at line 95, not exported). Rationale: keeps lean-risk-classify private (no coupling to verifier), reuses existing exported API, no new helpers needed. AC-6 wording updated above.

**reviewer-boundary violation 2 — agent-roles.json scope ambiguity:** Resolution applied — **Bash subprocess path chosen**. covers-verify.mjs runs as a Bash subprocess invoked by SKILL.md, not a registered agent. Task 9 is rewritten to NOT modify `.pipeline/agent-roles.json` and instead add a one-line comment in SKILL.md documenting the design choice. AC-9 wording updated above.

**reviewer-boundary violation 3 — new [covers] signal format:** Resolution applied — `[covers] <N> tests resolved, <M> gaps` is **diagnostic stderr output only**, NOT a registered control signal. No `docs/SIGNAL-PROTOCOL.md` update needed; nothing consumes it programmatically (it's for human/agent reading in logs). Task 7 / AC-7 wording updated above.

**reviewer-boundary violation 4 + reviewer-logic edge case — @covers syntax normalization:** Resolution applied — Task 1 AC-1 is **tightened** to add explicit normalization assertions (cases d + e): leading `./` stripped, Windows backslashes converted to forward-slashes. The parser is the single normalization point (Task 4); the map builder (Task 5) and verifier (Task 6) consume canonical forward-slash paths. Wording updated above.

**reviewer-logic issue 1 — Task 1 AC-6 sub-assertions for parser→map→lookup flow:** Resolution applied — Task 3 AC-3 case (a) is **expanded** to include explicit sub-assertions: parser sees the test file's @covers, map keys match canonical paths, lookup returns the correct test path. Plus new case (d) covers batched subprocess isolation. Wording updated above.

**reviewer-logic issue 2 — Task 3 AC-3 "no @covers references" boundary:** Resolution applied — Task 3 AC-3 case (b) is **clarified**: "gap" means the touched src file is **not a key in the impact map** (i.e., no test's @covers declares it). NOT "file not declared anywhere" or "file has no covering test that ran" — the boundary is map-membership. Wording updated above.

**reviewer-logic issue 3 + reviewer-safety issue — Task 10 AC-10 backfill heuristic:** Resolution applied — Task 10 is **expanded** with explicit multi-match, zero-match, and path-traversal-safety constraints:
- Multi-match → emit `[covers-ambiguous]`, skip write, exit non-zero. Operator hand-edits.
- Zero-match → emit `[covers-no-source]`, skip write.
- Path-traversal → validate inferred path stays under project root AND file exists on disk before writing. If either fails, emit `[covers-rejected]` and SKIP. `../../../etc-test.mjs` MUST NOT produce `@covers ../../../etc`.

These resolutions are authoritative; implementer must reference them when there's ambiguity. Original AC text above is **superseded** by the narrowed wording in this section where they conflict.

### Approach summary
- Decision: Pure ESM parser + map builder + CLI verifier; verifier reads handoff via existing `handoff-utils.mjs` exports (Option B); wired into implement skill as a post-coder Bash subprocess step (no agent-roles entry); `@covers` tag syntax is `// @covers <repo-relative-src-path>` (JS comment, one source path per line, multiple lines allowed); parser is the single normalization point (forward-slash, no leading `./`); TDD-structured in three waves per GENERAL.md §TDD discipline.
- Trade-off: Backfill is operator-triggered (`node scripts/covers-backfill.mjs`), not automatic — impact map is sparse until the operator runs it, so coverage gaps will be reported for pre-existing touched files on first few runs. Backfill itself is conservative — refuses to write on multi-match, zero-match, or path-traversal cases (operator must hand-edit those).
- Uncertainty: Pre-existing test files may have idiosyncratic naming that backfill's heuristic can't infer; the `--dry-run` flag + ambiguity rejection lets the operator review before committing.
