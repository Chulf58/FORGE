## Boundary Review: Add conductor-managed dispatch context for in-session subagent attribution

### Violations
- [ ] None detected

### Verified
- [x] **Schema/contract backward compatibility** — `resolveRunId(projectDir, payload)` adds dispatch-context as 4th resolution path. Pre-existing callers (`subagent-start.js`, `ctx-session-start.js`) transition from direct `findActiveRun` to the new function. All 3 earlier resolution paths (env var, worktree-path, then dispatch-context) preserve existing precedence. `findActiveRun` remains final fallback. Validated by 10/10 passing tests.
- [x] **New file path safety** — `.pipeline/dispatch-context.json` is a new control file following established `.pipeline/*.json` convention. No conflicts with existing files (`forge-config.json`, `project.json`, `agent-roles.json`, `board.json`, `gate-pending.json`, etc.). Path placement and naming consistent with GENERAL.md #MCP server contract.
- [x] **Module boundary — export scope** — `cleanupStaleDispatchContext(projectDir)` exported from `ctx-session-start.js` for testability (AC-4 comment). Function is async best-effort cleanup (never throws), wired into `main()` before `cleanupStaleSingleton`. Exported symbol is single and narrowly scoped — follows GENERAL.md convention of hook modules exporting internal functions only when test-required.
- [x] **SKILL.md instruction placement** — Dispatch-context write/delete (try/finally pattern) correctly placed in Step 3 of `skills/explore/SKILL.md` (before researcher Agent call) and Step 1b of `skills/plan/SKILL.md` (before brainstormer Agent call in vague-input branch). Instructions follow agent invocation control-flow points where runId is known and agent dispatch is imminent. Deletion-on-error via try/finally prevents orphaned files if subagent crashes.
- [x] **Contract completeness — RUN_ID_RE validation** — New dispatch-context path validates `ctx.runId` against existing `RUN_ID_RE` pattern (`/^r-[a-zA-Z0-9]+$/`) before accepting. Consistent with env-var (step 1) and worktree-path (step 2) validation. Malformed entries fall through silently (fail-open per GENERAL.md).
- [x] **Type correctness — no `any` types** — Handoff code uses `typeof` guards throughout (`typeof ctx.runId === 'string'`, `typeof data.createdAt === 'string'`, `typeof payload.cwd === 'string'`). No unguarded assertions. Cleanup function uses `const age = Date.now() - new Date(data.createdAt).getTime()` with `isNaN(age)` guard. All parameters explicitly typed in function signatures.
- [x] **Async safety** — `cleanupStaleDispatchContext` and `emitStaleUnitNoticeIfAny` both `await`ed in `main()` (line 241). `fs.promises` used throughout (no sync I/O for blocking operations). `try/catch` wraps all async operations in cleanup path. No fire-and-forget calls.
- [x] **Data persistence — control-file contract** — Dispatch-context file is ephemeral: written immediately before Agent dispatch, deleted immediately after (try/finally). On conductor crash, SessionStart cleanup (5-minute staleness threshold) removes orphans. Behavior aligns with transient task file pattern documented in GENERAL.md #Conductor sessions. Absent/unreadable files are no-op (fail-open).
- [x] **Test wave ordering** — Handoff declares TDD structure: AC-4 (task 4) includes `ctx-session-start.test.js` stub (wave 1 red bar), canonical tests in `hooks/dispatch-context-test.js` covering all 4 resolution paths + cleanup. Handoff verification shows 10/10 pass (green bar). No enforcement infrastructure modified beyond test infrastructure.

### Per-criterion verdicts
- `AC-2: MET` — `resolveRunId` dispatch-context path implemented with RUN_ID_RE validation, fail-open error handling, and correct precedence (4th of 4)
- `AC-3: MET` — `subagent-start.js` imports and uses `resolveRunId` at dispatch site (line 7, line 30)
- `AC-4: MET` — `cleanupStaleDispatchContext` async function added to `ctx-session-start.js`, wired into `main()` before `cleanupStaleSingleton`, exported for testability, 5-minute staleness threshold enforced
- `AC-5: MET` — `skills/explore/SKILL.md` Step 3 documents dispatch-context write before researcher Agent, delete after (try/finally)
- `AC-6: MET` — `skills/plan/SKILL.md` Step 1b (vague-input branch) documents dispatch-context write before brainstormer Agent, delete after (try/finally)

### Verdict
**APPROVED** — all boundary checks pass. Contract is backward compatible, new file path is conflict-free, module exports are narrowly scoped, instruction placement aligns with agent dispatch control flow, type correctness is enforced, async safety is sound, persistence model matches transient-control-file contract, and TDD wave structure is present with 10/10 test pass rate.
