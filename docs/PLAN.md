## Active Plan

### Feature: clear gate-pending.json after worker consumes approval (TODO 9a9d29b2 AC-2)

Summary: Delete `gate-pending.json` from the worktree after the worker injects the approval resume message, eliminating stale-file risk in `mcp/forge-worker.mjs`.

#### Phase 1 — Failing test (TDD wave 1 — red bar)

- [ ] 11. Add failing test for post-approval gate-file deletion (`mcp/gate-pending-guard-test.mjs`) (wave: 1)
  Intent: Establish a red bar that will only pass when the worker clears the gate file after injecting the approval resume message, preventing silent regression.
  Verify: AC-11: A new test scenario in `mcp/gate-pending-guard-test.mjs` (or a new peer file if isolation is needed) calls the post-approval consume path and asserts the gate file no longer exists on disk after the worker's inject completes; the test exits non-zero before the implementation change is made.

#### Phase 2 — Implementation (TDD wave 2 — green bar)

- [ ] 12. Delete gate-pending.json after approval inject in `mcp/forge-worker.mjs` (`mcp/forge-worker.mjs`) (wave: 2)
  Depends: 11
  Intent: Eliminate stale-file risk by removing the gate file immediately after the resume message is pushed, completing the consume lifecycle that AC-1 (gate-name match guard) left open.
  Verify: AC-12: Inside the `decision === 'approved'` block (lines 672–683 of `mcp/forge-worker.mjs`), after `inputChannel.push(...)` and before or after `resetWorkerTimer()`, a `unlinkSync(gatePath)` call (wrapped in try/catch, fail-open) removes the file; a `[forge-worker] cleared gate file after approval: <gateName>` line is written to the log; the test from task 11 now exits 0.

#### Phase 3 — Regression (TDD wave N)

- [ ] 13. Full regression suite green after gate-file clear (`scripts/run-tests.mjs`) (wave: 3)
  Depends: 12
  Intent: Confirm no existing test broke from the deletion — particularly tests that verify gate1→gate2→commit flow and the `waitForGateDecision` polling loop.
  Verify: AC-13: `node scripts/run-tests.mjs` exits 0 with the same pass count as baseline (30/32 or better); no test that previously passed now fails; `mcp/gate-pending-guard-test.mjs` exits 0.

### Research needed

None. Grep across all source files confirms the readers of `gate-pending.json`:

- `skills/approve/SKILL.md` (Step 1–2) — reads BEFORE worker consumes; safe to delete after inject.
- `skills/apply/SKILL.md` (Step 1b) — reads gate2/approved state, which is a fresh write by the implement worker at gate2 time; gate1 approved file being deleted does not affect this read. Gate2 approved file is superseded by the commit gate write, which is safe.
- `hooks/workflow-guard.js` (line 120) — reads to check gate2 approved during apply runs; same reasoning as apply skill.
- `mcp/server.js` (lines 940–952) — already clears on commit gate; comment explicitly notes gate1/gate2 are NOT cleared by server because approve+apply skills read them. The worker clearing after inject is the missing step the comment anticipated.
- `bin/forge-worktree.js` (line 150/155) — reads for dashboard display; file absent after consumption is handled gracefully (existsSync check at line 150).
- `hooks/bash-guard.js` (line 313) — reads for commit guard; missing file treated as fail-open per line 294 comment.
- `hooks/ctx-stop.js` (line 62) — reads for SessionStop display; wrapped in try/catch (fail-open).
- `scripts/dashboard-server.mjs` (line 104) — reads for TUI dashboard; missing file = no gate card shown, correct post-consume behavior.

All readers are either pre-consume (approve skill) or tolerant of absence. Deletion is the correct lifecycle closure.

### Risk surface

- `fs` write (delete) inside `.pipeline/` in a worktree path — reviewer-safety surface.
- Gate-approval flow modification — reviewer-boundary surface.
- No shell commands, no network, no auth/crypto, no schema changes.

### Approach summary
- Decision: Option A — delete `gate-pending.json` in the worker immediately after `inputChannel.push(...)` (lines 677–681 of `mcp/forge-worker.mjs`), wrapped in try/catch fail-open. TDD-structured in three waves. Rationale: the approve skill reads the file before the worker resumes; all other readers tolerate absence; ARCHITECTURE.md describes the file as "temporary"; deletion matches the commit-gate precedent already in `forge_set_gate`.
- Trade-off: Deleting removes forensic visibility of gate1/gate2 approved state from disk; accepted because the approved state is durably stored in `run.gateState` via `forge_set_gate` → `updateRun` before the worker sees `approved`.
- Uncertainty: None — grep confirms all readers are pre-consume or fail-open on absence.

### Resolution 2026-05-11
Removed inherited Features 1 (conductor-managed dispatch context, r-31711ab4 plan-leak) and 2 (apply worktree resolution by stage progression, merged r-459ec2aa) from this run's PLAN.md after gate1 reviewers approved. Implementer must execute Feature 3 (tasks 11-13) only — the AC-2 scope from TODO 9a9d29b2. Root-cause planner append-only rule fix tracked separately.
