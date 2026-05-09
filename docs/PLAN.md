## Active Plan

(Stale "Per-run context isolation" feature block removed by conductor — already shipped today via r-83ef4be9 → commit 5679aaf2 → merge 476dca08. The active plan below targets a different feature.)

### Feature: Worker output-verification mtime cross-check

Summary: Replace git-diff-based output verification with mtime cross-check; extract into a testable helper; close TODOs 756bd820 (Bug 2) and a625d351.

## Problem

**TODO `756bd820` (Bug 2 only — Bug 1 closes via `36fdb461`):**
> "BUG 2 — WORKER MUST CROSS-CHECK FILE MTIME (remaining work): Worker's gate2-readiness check accepts the [reviewer-verdict] signal in agent output as authoritative. Does not verify the verdict FILE was actually persisted (mtime > agent startedAt). Even with per-run dirs (Bug 1 fix), a reviewer could fail to Write for other reasons: disk full, permission denied, transient error, agent emitted signal but Write tool refused for path reasons. subagent-stop already flags `completedAt: null` for these cases, but the worker's verdict aggregation doesn't act on it."
>
> AC-1: Worker's verdict aggregation reads each reviewer's expected output file, compares mtime to agent startedAt, treats stale-or-missing files as no-verdict.
> AC-2: A reviewer with [reviewer-verdict]=APPROVED but stale/missing file does NOT advance the run to gate2; instead surfaces as REVISE-unresolved (consistent with existing policy).
> AC-3: subagent-stop's existing `completedAt: null` flag is honored — outcomes with null completedAt are treated as no-verdict.
> AC-4: Test or smoke covering the stale-file scenario: dispatch reviewer with a stale verdict file already on disk, verify worker rejects the phantom verdict.

**TODO `a625d351`:**
> "Worker false-negative on gitignored-doc detection — affects documenter, planner, and any worker that diff-checks gitignored doc paths. Workers that perform `git diff --stat HEAD` (or similar) to verify 'did the agent write what it claimed?' get a FALSE NEGATIVE for any change to these files. Git doesn't show gitignored files in diffs even if they're modified on disk."
>
> AC1: Worker correctly detects documenter writes to gitignored doc files (CHANGELOG, ARCHITECTURE, DECISIONS, etc.) as success rather than re-invoking.
> AC2: For files NOT modified by documenter (mtime unchanged), worker still re-invokes (existing behavior preserved).
> AC3: Same fix pattern applied to any other worker → agent verification check that uses git diff against gitignored files.

## Root cause

- `skills/implement/SKILL.md:192` — `git diff --stat HEAD` used for post-coder output verification; silent false-negative for gitignored files (PLAN.md, CHANGELOG.md, etc.).
- `skills/debug/SKILL.md:84` — same `git diff --stat HEAD` pattern.
- `skills/refactor/SKILL.md:80` — same `git diff --stat HEAD` pattern.
- `skills/implement/SKILL.md:261` (step 5b) — verdict aggregation reads `[reviewer-verdict]` signals from reviewer output files but does not check file mtime vs. agent startedAt; stale files from prior runs accepted as fresh.
- `skills/apply/SKILL.md:132,147` — `git diff --name-only HEAD` used in commit detection; same gitignore-blindness for doc files.
- The verification question in all cases is "did the file change?" — git cannot answer this for gitignored files; filesystem mtime can.

## Approach

Extract a testable helper script (`scripts/verify-output.mjs`) that answers "is this file fresher than timestamp T?" with exit-code and JSON stdout semantics matching the existing script pattern (`scripts/lean-risk-classify.mjs`). Skills invoke the helper via Bash. Tests use `node:test` (the existing test framework in this repo — confirmed via `scripts/lean-risk-classify.test.mjs`). Assumption: NTFS mtime resolution is 100 ns — finer than the second-level granularity of most CI checks; no rounding guard needed. Same-machine execution assumed; no NTP/clock-skew risk.

---

- [ ] 1. Add failing tests for Bug 2 mtime rejection (`scripts/verify-output.test.mjs`) (wave: 1)
  Intent: Establish a red-bar baseline that will fail on current code, proving the bug exists before the fix.
  Verify: AC-1: Running `node --test scripts/verify-output.test.mjs` exits non-zero; at least two tests fail — one reproducing a stale-mtime verdict file being accepted (756bd820 Bug 2), one reproducing a gitignored-file write going undetected (a625d351).

- [ ] 2. Add failing test for stale-verdict regression (756bd820 AC-4) (`scripts/verify-output.test.mjs`) (wave: 1)
  Intent: Cover the specific AC-4 scenario — a stale reviewer verdict file present on disk before the agent runs — so the regression cannot reappear silently.
  Verify: AC-2: A dedicated test simulates a verdict file with mtime older than a mock agent startedAt; the test fails (red bar) before the helper is implemented.

- [ ] 3. Implement `scripts/verify-output.mjs` helper (wave: 2)
  Depends: 1, 2
  Intent: Provide the single testable surface for mtime-based output verification so all skill files call the same logic rather than duplicating inline checks.
  Verify: AC-3: `node scripts/verify-output.mjs --file=<path> --since=<epoch-ms>` exits 0 when the file exists and `mtime >= since`; exits 1 when file is absent, exits 2 when file exists but `mtime < since`; stdout is `{"ok":true|false,"reason":"..."}` JSON on every exit.

- [ ] 4. Update implement, debug, refactor skills to use mtime check for post-coder verification (`skills/implement/SKILL.md`, `skills/debug/SKILL.md`, `skills/refactor/SKILL.md`) (wave: 3)
  Depends: 3
  Intent: Replace the `git diff --stat HEAD` false-negative with a filesystem mtime call so gitignored file writes are correctly detected.
  Verify: AC-4: Post-coder verification in all three skills calls `node scripts/verify-output.mjs` for declared touched files; no `git diff --stat` used for the "did the agent write?" question; gitignored-doc writes are no longer treated as no-output.

- [ ] 5. Update implement, debug, refactor skills to cross-check reviewer verdict file mtime (`skills/implement/SKILL.md`, `skills/debug/SKILL.md`, `skills/refactor/SKILL.md`) (wave: 4)
  Depends: 4
  Intent: Step 5b's verdict aggregation must confirm the verdict file was actually persisted after the reviewer started, not just that a signal was emitted, closing 756bd820 AC-1 through AC-3.
  Verify: AC-5: Step 5b in each skill calls `node scripts/verify-output.mjs --file=<verdict-file> --since=<reviewer-startedAt>` before accepting a verdict; a file that fails mtime check is treated as no-verdict; the run proceeds to REVISE-unresolved if any reviewer yields no-verdict.

- [ ] 6. Update apply skill to use mtime check for documenter output verification (`skills/apply/SKILL.md`) (wave: 3)
  Depends: 3
  Intent: Apply skill's documenter re-invoke decision currently uses `git diff`; switching to mtime eliminates false re-invokes on gitignored doc files (CHANGELOG, ARCHITECTURE, DECISIONS).
  Verify: AC-6: The apply skill's documenter-verification step calls `node scripts/verify-output.mjs` for each expected doc file; documenter is not re-invoked when mtime shows the file was written; documenter IS re-invoked when mtime is unchanged.

- [ ] 7. Tests green — all verify-output tests pass (`scripts/verify-output.test.mjs`) (wave: 5)
  Depends: 3, 4, 5, 6
  Intent: Confirm the TDD cycle is complete — every test written in Tasks 1 and 2 now passes with the helper implemented.
  Verify: AC-7: `node --test scripts/verify-output.test.mjs` exits 0; all tests including the AC-4 stale-verdict regression test pass.

### Research needed

None.

### Approach summary
- Decision: Extract a standalone `scripts/verify-output.mjs` helper with deterministic exit codes (matching the pattern of `scripts/lean-risk-classify.mjs`) so skill markdown files invoke it via Bash and the logic is unit-testable independently of the LLM.
- Trade-off: Skill files grow a Bash invocation per verification point; this is consistent with `completeness-check.mjs` and `reviewer-dispatch.mjs` precedent so not novel complexity.
- Uncertainty: The apply skill commit-detection path (`skills/apply/SKILL.md:132`) uses `git diff` for both listing changed files AND detecting commits — the mtime fix applies only to the output-detection question; the commit-listing use is out of scope and must not be changed.

### Resolution of plan-stage REVISE verdicts

Plan-stage reviewers (boundary, performance) returned REVISE — no BLOCKs. Conductor decisions follow; implementer should treat these as authoritative AC supplements.

**reviewer-boundary REVISE — wave ordering**: Tasks 4 and 5 both targeted wave 3 and both modify `skills/implement/SKILL.md`, `skills/debug/SKILL.md`, `skills/refactor/SKILL.md`. Resolution applied above: Task 5 bumped to wave 4 (Task 5 now depends on Task 4 completing). Task 6 stays at wave 3 (different file: `skills/apply/SKILL.md`). Task 7 bumped to wave 5 (depends on 3, 4, 5, 6).

The implementer can either edit Tasks 4 and 5 in two passes through each skill file, or merge them into a single edit per skill (acceptable shortcut — the merged edit is still semantically two changes).

**reviewer-performance REVISE — batch invocation (advisory)**: helper invocation is one node spawn per verified file. For a typical implement run this is ~3–10 spawns per check round. Precedent scripts (`scripts/completeness-check.mjs`, `scripts/reviewer-dispatch.mjs`) use the same per-item pattern. Resolution: **keep single-file-per-invocation contract** for consistency. If profiling shows >500 ms aggregate cost during implementation, the implementer MAY add a batch mode `--files=<p1>:<p2>:... --since=<epoch-ms>` returning a JSON map. Not a blocker — defer until measured.

**reviewer-performance REVISE — same-second mtime tolerance (advisory)**: helper compares `mtime >= since`. On NTFS (Windows, this project's primary target) mtime resolution is 100 ns, so same-second collisions are vanishingly rare. Resolution: **use `>=` (inclusive)** in the helper; document the assumption inline in `scripts/verify-output.mjs` that filesystem mtime resolution is finer than the caller's `since` precision. If cross-platform CI is added later, the implementer should revisit (e.g. subtract 1 s from `since` on filesystems with second-only resolution).

These resolutions supersede any conflicting text above. The implementer should reference this section when there's ambiguity.
