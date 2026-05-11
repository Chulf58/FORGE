## Active Plan

### Feature: conductor-managed dispatch context

Summary: Add a 4th resolution path to `resolveRunId` so conductor in-session subagent dispatches are attributed to the correct run.

#### Phase 1 — Failing tests (TDD wave 1 — red bar)

- [ ] 1. Write failing tests for dispatch-context resolution (`hooks/dispatch-context-test.js`) (wave: 1)
  Intent: Establish a red bar before any implementation exists, preventing Red+Green collapse per GENERAL.md §TDD discipline.
  Verify: AC-1: `node hooks/dispatch-context-test.js` exits non-zero; test cases cover (a) valid dispatch-context file present → `resolveRunId` returns its runId, (b) file present with invalid runId format → falls through to findActiveRun, (c) file absent → falls through, (d) file present but `createdAt` >5 min old at SessionStart → file is deleted, (e) `subagent-start.js` swap from `findActiveRun` to `resolveRunId` is exercised and resolves correctly. No `.skip` markers.

#### Phase 2 — Implementation (TDD wave 2 — green bar)

- [ ] 2. Extend `resolveRunId` with dispatch-context file path (`hooks/hook-utils.js`) (wave: 2)
  Depends: 1
  Intent: Give conductor sessions a 4th resolution path that beats the ambiguous `findActiveRun` fallback when 2+ non-terminal runs coexist.
  Verify: AC-2: `resolveRunId` reads `.pipeline/dispatch-context.json`, validates the `runId` field against `^r-[a-zA-Z0-9]+$`, returns it when valid; this path executes AFTER env-var and worktree-path checks and BEFORE `findActiveRun`; file absent or unreadable → falls through silently (fail-open); existing 3-path behavior is unchanged.

- [ ] 3. Swap `subagent-start.js` line 30 from `findActiveRun` to `resolveRunId` (`hooks/subagent-start.js`) (wave: 2)
  Depends: 2
  Intent: Attribution at SubagentStart must use the same precedence chain as SubagentStop so the agent record is consistent end-to-end.
  Verify: AC-3: `subagent-start.js` imports `resolveRunId` from `./hook-utils` and calls `resolveRunId(projectDir, payload)` in place of `findActiveRun(projectDir)` at line 30; `findActiveRun` is no longer called directly at that site; existing attribution behavior when a single run is active is unchanged.

- [ ] 4. Add SessionStart cleanup for stale dispatch-context file (`hooks/ctx-session-start.js`) (wave: 2)
  Depends: 2
  Intent: Prevent a crashed conductor session from leaving a stale dispatch-context file that would mis-attribute future subagents.
  Verify: AC-4: `ctx-session-start.js` checks for `.pipeline/dispatch-context.json` at SessionStart; if the file exists and its `createdAt` timestamp is more than 5 minutes in the past, the file is deleted and a `[forge-dispatch-ctx] stale dispatch-context deleted` line is written to stderr; if the file is absent or fresh, no action is taken; the check never throws (fail-open).

- [ ] 5. Wire dispatch-context write/delete into `skills/explore/SKILL.md` (`skills/explore/SKILL.md`) (wave: 2)
  Depends: 2
  Intent: The explore skill is the primary conductor in-session dispatch site; it must write the context file so hooks can resolve the runId before the researcher subagent fires.
  Verify: AC-5: `skills/explore/SKILL.md` contains a step instructing the conductor to write `.pipeline/dispatch-context.json` (with `runId` and `createdAt`) immediately before the `Agent(subagent_type="forge:researcher")` call and to delete the file immediately after the Agent returns (or on error); the step references the file path exactly as `.pipeline/dispatch-context.json`.

- [ ] 6. Wire dispatch-context write/delete into `skills/plan/SKILL.md` for brainstormer dispatch (`skills/plan/SKILL.md`) (wave: 2)
  Depends: 2
  Intent: The plan skill dispatches the brainstormer in-session when input is vague; that subagent invocation must also carry dispatch context for correct attribution.
  Verify: AC-6: `skills/plan/SKILL.md` contains instructions to write `.pipeline/dispatch-context.json` (with `runId` and `createdAt`) before invoking the brainstormer via `Agent(subagent_type="brainstormer")` and to delete it after the brainstormer returns; the step is placed adjacent to the existing brainstormer invocation instruction.

#### Phase 3 — Regression (TDD wave N)

- [ ] 7. Full regression suite green after dispatch-context feature (`hooks/dispatch-context-test.js`, `scripts/run-tests.mjs`) (wave: 3)
  Depends: 2, 3, 4, 5, 6
  Intent: Confirm the new test file passes and no existing tests regressed from hook or skill edits.
  Verify: AC-7: `node hooks/dispatch-context-test.js` exits 0; `node scripts/run-tests.mjs` exits 0 with no skipped or deleted cases.

### Research needed

None — all design decisions are derivable from codebase evidence (hook-utils.js resolveRunId, resolve-runid-test.js structure, ctx-session-start.js stale-cleanup pattern, skills/research/SKILL.md confirming worker-spawn path). The only confirmed open surface is multi-flight concurrent in-session dispatch; it is explicitly out-of-scope.

### Approach summary
- Decision: 4th resolution path inside `resolveRunId` (after env var + worktree-path, before findActiveRun) reads a single-flight `.pipeline/dispatch-context.json`; conductor skills write the file before Agent call and delete after; SessionStart cleans up stale files (>5 min); subagent-start swaps to resolveRunId to close the start/stop attribution gap; TDD-structured in three waves.
- Trade-off: Single-flight discipline means concurrent in-session Agent dispatches are not supported — acknowledged as out-of-scope; conductor sessions today serialise in-session dispatches.
- Uncertainty: If a future skill introduces concurrent in-session dispatch, the single-file approach will need a multi-key scheme (e.g. keyed by dispatch nonce).

---

### Feature: apply worktree resolution by stage progression

Summary: Fix Step 2a of `/forge:apply` and the `apply-context-inject` hook to resolve worktrees by `stages.implement` completion rather than `pipelineType`.

- [x] 8. Update Step 2a of `/forge:apply` to filter by stage progression (`skills/apply/SKILL.md`)
  Intent: Runs that started as `pipelineType=plan` and advanced through the implement stage are currently excluded from worktree resolution because `pipelineType` is frozen at creation time; filtering by `stages.implement.status` correctly identifies eligible runs regardless of origin type.
  Verify: AC-8: Step 2a no longer references `pipelineType` values `"implement"`, `"refactor"`, or `"debug"` as the selection criterion; instead it instructs the worker to call `forge_list_runs` (no pipelineType filter), then for each candidate call `forge_get_run` and select only runs where `stages.implement.status === "completed"` (or where `stages.debug.status === "completed"` / `stages.refactor.status === "completed"`) and `worktreePath` is non-null; the most-recent-by-`createdAt` among those is chosen.

- [x] 9. Add a failing test for stage-progression resolution in `apply-context-inject-test.js` (`hooks/apply-context-inject-test.js`)
  Intent: Establish a red bar verifying that a `pipelineType=plan` run with `stages.implement.status=completed` is accepted, and that a `pipelineType=implement` run with no `stages` field still works (backward compat), before touching the hook.
  Verify: AC-9: `node hooks/apply-context-inject-test.js` exits non-zero; at least one test case uses a run fixture with `pipelineType: 'plan'` and `stages: { implement: { status: 'completed' } }` and asserts context IS injected; a second test case uses a run fixture with `pipelineType: 'implement'` and `stages` absent and asserts context IS injected (backward compat); both assertions fail before the implementation change.

- [x] 10. Fix `apply-context-inject.js` to filter by stage progression (`hooks/apply-context-inject.js`)
  Depends: 9
  Intent: The hook currently passes `{ pipelineType: 'implement' }` to `listRuns`, missing plan-origin runs that ran through implement; filtering all runs then checking `stages` on the full run object corrects the exclusion.
  Verify: AC-10: `hooks/apply-context-inject.js` no longer calls `listRuns(projectDir, { pipelineType: 'implement' })`; it calls `listRuns(projectDir)` (no pipelineType filter) and then for each candidate calls `getRun` and accepts the run when `run.worktreePath` is non-null AND (`run.stages?.implement?.status === 'completed'` OR `run.stages?.debug?.status === 'completed'` OR `run.stages?.refactor?.status === 'completed'` OR `run.pipelineType === 'implement'` OR `run.pipelineType === 'debug'` OR `run.pipelineType === 'refactor'`); the fallback to `pipelineType` ensures backward compat with older runs that lack a `stages` field; `node hooks/apply-context-inject-test.js` exits 0.

### Research needed

None — the exact filter site in `hooks/apply-context-inject.js` (line 54) and `skills/apply/SKILL.md` (line 68) are confirmed. The `stages` field shape is confirmed from existing run fixtures in `hooks/worker-task-inject-marker-test.mjs`. Backward compat requirement (runs without `stages`) is addressed by the pipelineType fallback.

### Risk surface

- No shell commands, no `fs` writes outside `.pipeline/`, no auth/crypto, no network.
- Schema change: run fixture shape in tests gains a `stages` field — additive only, no contract break.
- Signal format: no change to gate files, no change to `run-active.json`.
- Files touched: `skills/apply/SKILL.md` (markdown doc), `hooks/apply-context-inject.js` (hook logic), `hooks/apply-context-inject-test.js` (test).

### Approach summary
- Decision: Dual-criteria filter — check `stages.<phase>.status === 'completed'` first; fall back to legacy `pipelineType` match for runs that pre-date the `stages` field. This is the smallest change that fixes the bug without breaking existing runs.
- Trade-off: The fallback means the old pipelineType bug could still trigger for very old runs that genuinely lack `stages`; accepted as a known limitation of backward compat.
- Uncertainty: None — the stages field is present in all recent runs per fixture evidence.
