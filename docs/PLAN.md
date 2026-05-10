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
