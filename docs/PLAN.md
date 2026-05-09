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

---

### Feature: TDD Guard Hook

Summary: Build `hooks/tdd-guard.js`, a PreToolUse hook that blocks Write/Edit on source files when no failing test exists for the targeted module.

#### Hook contract (from `hooks/bash-guard.js:316-327` and `hooks/bash-guard.js:11-27`)

- **stdin:** JSON payload with at minimum `tool_input.file_path` (used by **both** Write and Edit) and `cwd`. Confirmed by `hooks/workflow-guard.js:191-194` and `hooks/control-file-guard-test.js:146` — both tools use `file_path`. Coder should still apply a defensive `tool_input.file_path || tool_input.path` extraction to match the existing pattern in `workflow-guard.js`. (See `docs/RESEARCH/tdd-guard-hook-unknowns.md` Q2.)
- **exit 0:** allow the tool call through.
- **exit 2 + stdout JSON deny envelope + stderr message:** block the tool call. Deny envelope shape from `bash-guard.js:16-26`: `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "<msg>" } }`. `console.error(msg)` provides the legacy stderr backup (`bash-guard.js:26`). Exit 2 alone is silently discarded by the current runtime (`bash-guard.js:15`).
- **stdin reading:** readline + timeout pattern, fail-open on parse error (`bash-guard.js:456-466`). Timeout constant from `hook-utils.js` (`STDIN_TIMEOUT_LONG`).

#### Source-file detection rule

Based on `hooks/workflow-guard.js:14-31` (`isSourceFile` function), which explicitly excludes `/.pipeline/`, `/docs/`, `/.claude/`, `/scaffolds/`, `/node_modules/`, `/.git/`, `/mcp/`, `/hooks/`, `/skills/`, `/bin/`. The tdd-guard must use a **narrower, additive rule**: intercept Write/Edit on files under `hooks/`, `bin/`, `scripts/`, `mcp/` that are NOT test files. Test file exclusion: path ends with `.test.js`, `.test.mjs`, or is under `__tests__/` or `tests/`. Config/doc exclusion: ends with `.md` or `.json` at project root level (matches workflow-guard.js:29-30 precedent).

**Trigger tools:** Write, Edit, **and MultiEdit** — `MultiEdit` is a distinct PreToolUse event (not an Edit alias), confirmed by Claude Code hooks reference; community practitioners use `"Edit|MultiEdit|Write"` as a three-part matcher. (See `docs/RESEARCH/tdd-guard-hook-unknowns.md` Q1.) `hooks/hooks.json` needs three matcher entries.

#### "Failing test exists" check — chosen mechanism

**Option (a): run the test file** — confirmed by research doc §4.1 (tdd-agentic-llm-setups.md:92-96): "Test reporter integration parses Vitest/Jest/pytest/etc. results. File-pattern validation: rule says 'edits to `src/foo.py` require a failing test in `tests/test_foo.py`.'" Research doc §3.1 (tdd-agentic-llm-setups.md:44-46) states: "the harness, not the agent, runs the tests; the harness, not the agent, decides green/red." Option (a) is the research-recommended mechanism.

Concrete: for a target file `hooks/foo.js`, the hook resolves a test file in this **deterministic order** (first match wins):
  1. Adjacent: `<dir>/<name>.test.js` or `<dir>/<name>.test.mjs` (e.g., `hooks/foo.test.js`)
  2. Sibling tests dir: `tests/<name>.test.js` or `tests/<name>.test.mjs`
  3. `__tests__/<name>.test.js` under the same directory

If found, runs `node --test <test-file>` with a short timeout. Decision tree:
  - Exit non-zero ⇒ a failing test exists ⇒ **allow** the write (TDD red phase confirmed). This includes the case where the test file imports a not-yet-existing source module (module-not-found ⇒ non-zero exit ⇒ valid red bar for the very-first write).
  - Exit 0 ⇒ all tests green OR no tests defined ⇒ **block** — no red phase observed.
  - Test file absent ⇒ **block** with a message directing the agent to write a failing test first.

**Known v1 limitation:** the hook cannot semantically verify that the failing test is *about* the target module — any failing test in the resolved test file counts. This is acceptable for v1 (file-path mapping); a v2 could parse test names. Document this in the deny message so agents understand the contract.

**Option (b) mtime:** rejected — research doc §3.3 (tdd-agentic-llm-setups.md:52-54) flags "tests that pass before implementation" as a failure mode that mtime cannot detect. A newer-than-source test file may contain only green tests.

**Option (c) sentinel file:** rejected — requires a companion PostToolUse hook writing sentinel files on every Bash test run; higher complexity and a separate failure surface.

#### Bypass mechanism

Env var `TDD_GUARD_BYPASS=1` — matches the session-toggle pattern described in research doc §4.1 (tdd-agentic-llm-setups.md:95). `bash-guard.js` uses `hasValidApprovalToken` from hook-utils; tdd-guard uses a simpler env-var check (no approval token needed — this is a developer opt-out, not a security boundary). A `.tddguardignore` file at project root can list path globs to skip (one per line).

#### Performance budget

<500 ms typical, <2 s worst case. `node --test <single-file>` on a fast local test file takes ~100–300 ms on this platform. Timeout guard: spawn with `timeout: 2000 ms`; on ETIMEDOUT — fail-open (allow the write, log a warning to stderr).

#### Failure modes

| Scenario | Behavior |
|---|---|
| Node not on PATH | Fail-open: `spawn` throws ENOENT → catch → `exitOk()` + stderr warning |
| Test file malformed / parse error | Fail-open: test runner exits non-zero → treated as failing test → allow write |
| Hook itself crashes / unhandled exception | Fail-open: `.catch(() => process.exit(0))` wraps main (same pattern as `bash-guard.js:466`) |
| Timeout (>2 s) | Fail-open: log warning, allow write |
| No test file found | Fail-closed: block write, message directs agent to write failing test first |
| Test file exists but contains zero test definitions (empty / only `.skip`) | Fail-closed: `node --test` exits 0 ⇒ treated as "all green" ⇒ **block**. Message: "test file has no executing tests — write a failing test first." |
| Test file imports not-yet-existing source module | Allow: module-not-found exits non-zero ⇒ counts as red bar (correct behavior for first-write TDD scaffold). |
| TDD_GUARD_BYPASS=1 | Fail-open: skip all checks, allow write |
| `.tddguardignore` glob match | Fail-open: skip checks for paths matched by glob; treated as a deliberate opt-out for documented exceptions. |

---

#### Phase 1 — Test cases for the hook (written first — TDD structure)

- [ ] 8a. Create minimal stub `hooks/tdd-guard.js` (wave: 1)
  Intent: Provide an importable module so Task 8b's tests can be authored against a real (but un-implemented) surface. Resolves reviewer-logic phase-ordering blocker — without a stub, `node --test hooks/tdd-guard.test.mjs` would fail with a module-load error rather than meaningful red-bar assertions.
  Verify: AC-8a: `hooks/tdd-guard.js` exists and exports the symbols the tests will exercise (e.g., `runGuard(payload, env): Promise<{exitCode, stderr}>`). The stub returns `exitCode: 0` unconditionally so that Task 8b's failure tests fail for the *right reason* (assertion mismatch, not import error). No production logic in the stub.

- [ ] 8b. Write failing tests for `hooks/tdd-guard.js` (`hooks/tdd-guard.test.mjs`) (wave: 1)
  Depends: 8a
  Intent: Establish the red bar for the hook itself — tests must fail because the stub returns the wrong answer, satisfying the TDD-structured requirement (research doc §3.2).
  Verify: AC-8b: `node --test hooks/tdd-guard.test.mjs` exits non-zero with the following test cases failing against the stub: (1) blocks Write when no test file exists for target; (2) blocks Write when test file exists but all tests pass (green); (3) blocks Write when test file exists but contains zero executing tests (empty / only `.skip`); (4) allows Write when test file exists and at least one test fails (red); (5) allows Write when test file imports not-yet-existing source module (module-not-found ⇒ non-zero exit); (6) allows Write on test files themselves; (7) allows Write when `TDD_GUARD_BYPASS=1` (bypass is checked **before** stdin parsing so a malformed payload + bypass still allows); (8) allows Write when path matches a `.tddguardignore` glob; (9) fail-open when `node --test` times out; (10) fail-open on hook stdin parse error; (11) fail-open when `spawn` throws ENOENT (node not on PATH). Each test case has at least one assertion; no `.skip`; no test deletion permitted to satisfy AC-9.

#### Phase 2 — Hook implementation

- [ ] 9. Implement `hooks/tdd-guard.js` (`hooks/tdd-guard.js`) (wave: 2)
  Depends: 8a, 8b
  Intent: Enforce the Red phase by blocking source-file writes until a failing test for the target module is observed, closing the Red+Green collapse failure mode documented in tdd-agentic-llm-setups.md:48-50.
  Verify: AC-9: All test cases from Task 8b pass (`node --test hooks/tdd-guard.test.mjs` exits 0) **without removing assertions, marking tests `.skip`, or deleting test cases authored in Task 8b**. The 11 test cases enumerated in AC-8b must all be present and execute at least one assertion each. Hook reads stdin via readline+timeout pattern matching bash-guard.js:456-466; deny envelope matches bash-guard.js:16-26 shape; fail-open on timeout/crash. Bypass evaluated before stdin parsing.

- [ ] 10. Register hook in `hooks/hooks.json` (`hooks/hooks.json`) (wave: 3)
  Depends: 9
  Intent: Activate the hook in the Claude Code runtime so it fires on every Write, Edit, and MultiEdit PreToolUse event, matching the existing Write/Edit matcher pattern at hooks.json:237-270 and including MultiEdit per researcher Q1.
  Verify: AC-10: `hooks/hooks.json` contains three new PreToolUse entries — matchers `"Write"`, `"Edit"`, and `"MultiEdit"` — all invoking `node "${CLAUDE_PLUGIN_ROOT}/hooks/tdd-guard.js"`; JSON is valid (`node -e "require('./hooks/hooks.json')"` exits 0).

- [ ] 11. ~~Add tdd-guard entry to `.pipeline/agent-roles.json`~~ — **DROPPED** per researcher Q3. Hook processes do not carry an `agent_type` in their stdin payload; `hooks/ctx-pre-tool.js:93-94` short-circuits when `agentType` is absent, so an agent-roles.json entry would have zero effect. See `docs/RESEARCH/tdd-guard-hook-unknowns.md` Q3.

### Research needed

(All resolved — see `docs/RESEARCH/tdd-guard-hook-unknowns.md` and the Resolution section below.)

### Resolution of plan-stage research findings

Researcher (`docs/RESEARCH/tdd-guard-hook-unknowns.md`) and gotcha-checker concur on three changes pinned into the plan body above:

1. **MultiEdit is a distinct PreToolUse event.** Task 10 AC-10 updated to require three matchers (`Write`, `Edit`, `MultiEdit`).
2. **Both Write and Edit use `tool_input.file_path`** (not `path`). Hook-contract section updated; coder should keep the defensive `file_path || path` fallback that `workflow-guard.js:191-194` uses.
3. **agent-roles.json entry is not required for hook processes.** Task 11 dropped (hooks have no `agent_type`; `ctx-pre-tool.js:93-94` short-circuits without one).

### Resolution of plan-stage reviewer verdicts

Plan-stage reviewers returned REVISE — `reviewer-boundary` 1 warning, `reviewer-logic` 1 blocker + 6 warnings. Verdict files: `.pipeline/context/reviewer-output/reviewer-boundary.md`, `.pipeline/context/reviewer-output/reviewer-logic.md`. Conductor decisions follow; implementer should treat these as authoritative AC supplements.

**reviewer-logic BLOCKER — Task 8 phase ordering:** Tests in the original Task 8 cannot fail meaningfully without an importable stub. Resolution applied: Task 8 split into **Task 8a** (create stub `hooks/tdd-guard.js` exporting `runGuard(payload, env)` returning `{exitCode: 0}` unconditionally) and **Task 8b** (write tests against the stub). Reviewer's recommended Option A.

**reviewer-logic warning — assertion-deletion in AC-9:** Resolution applied. AC-9 now explicitly forbids removing assertions, `.skip`-ing tests, or deleting test cases from Task 8b to satisfy the green-bar criterion. The 11 enumerated test cases must all be present.

**reviewer-logic warning — empty test file:** Resolution applied. Failure-mode table now has a row for "test file with zero executing tests"; behavior is fail-closed (block) with a specific deny message. AC-8b test case (3) covers this.

**reviewer-logic warning — test-file imports non-existent source:** Resolution applied. Decision tree now explicitly states this case is allowed (module-not-found ⇒ non-zero exit ⇒ valid red bar for first-write TDD). AC-8b test case (5) covers this.

**reviewer-logic warning — multiple test file matches:** Resolution applied. Test-file resolution order is now deterministic and documented (adjacent → `tests/` → `__tests__/`, first match wins).

**reviewer-logic warning — no semantic validation that failing test is about target:** Resolution applied. Documented as a known v1 limitation in the chosen-mechanism section; deny message will surface this so agents understand the contract. v2 could parse test names — out of scope for this run.

**reviewer-logic warning — bypass precedence:** Resolution applied. AC-9 specifies bypass is evaluated **before** stdin parsing so a malformed payload + bypass still allows. AC-8b test case (7) verifies this.

**reviewer-logic warning — line 105 stale text:** Already resolved in the prior research-findings pass; line 105 now correctly states both Write and Edit use `file_path`. No further action needed.

**reviewer-boundary warning — source-file detection scope vs `workflow-guard.js`:** `workflow-guard.js:14-31` excludes `/hooks/`, `/bin/`, `/mcp/` from its `isSourceFile` check because that hook gates **end-of-pipeline workflow steps** (apply-stage commit signals), not TDD coverage. `tdd-guard.js` operates at a different boundary — it gates *every* Write/Edit on plugin source code regardless of pipeline stage. The two scopes are intentionally disjoint and serve different policies. Resolution applied: noted here. Implementer must include a comment in `tdd-guard.js` explaining the deliberate scope difference so future readers don't try to "reconcile" the two scope rules.

These resolutions are authoritative; implementer must reference them when there's ambiguity.

### Approach summary
- Decision: Hook-enforced TDD guard (research §6.1 pattern) using `node --test <test-file>` to confirm a failing test exists before allowing source-file writes; fail-open on timeout/crash; `TDD_GUARD_BYPASS=1` env var for session opt-out.
- Trade-off: Spawning a node subprocess per Write/Edit/MultiEdit adds ~100–300 ms latency to every source-file write; acceptable given the <500 ms budget, but will be noticeable in tight edit loops.
- Uncertainty: All three plan-stage unknowns resolved (MultiEdit distinct, both tools use `file_path`, no agent-roles.json entry needed).
