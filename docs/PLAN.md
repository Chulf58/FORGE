# Active Plan

## Active Plan

### Feature: canUseTool callback — fine-grained per-agent tool permissions in forge-worker.mjs

Summary: Enforce agent `tools:` frontmatter at the SDK level in forge-worker.mjs by wiring a `canUseTool` callback into the `query()` call.

- [ ] 1. Parse agent frontmatter tool lists at worker startup (`mcp/forge-worker.mjs`) (wave: 1)
  Intent: Build an in-memory map of agent name → allowed tools from `agents/*.md` frontmatter so the `canUseTool` callback has the data it needs without reading files on every tool call.
  Verify: AC-1: At worker startup, all `agents/*.md` files are read, each file's YAML frontmatter `tools:` array is extracted, and a `Map<agentName, Set<toolName>>` is populated; the map is available in the module scope before `query()` is called.

- [ ] 2. Track agent ID → agent type as subagents are spawned (`mcp/forge-worker.mjs`) (wave: 2)
  Depends: 1
  Intent: Maintain a live `agentId → agentType` mapping by watching SDK stream messages so the `canUseTool` callback can resolve which agent is making a tool request.
  Verify: AC-2: When the `query()` stream emits a subagent-start message containing both an `agentID` and an agent type or name, the mapping is updated; when a subagent-stop message is received the entry is retained (lookups must still resolve after stop); the mapping is scoped per `query()` call and does not bleed across runs.

- [ ] 3. Implement and wire `canUseTool` callback into `query()` (`mcp/forge-worker.mjs`) (wave: 3)
  Depends: 2
  Intent: Enforce the per-agent tool allow-lists at the SDK permission layer so agents cannot use tools outside their declared frontmatter `tools:` array.
  Verify: AC-3: `query()` is called with a `canUseTool` option; when `agentID` is defined, the callback resolves the agent type via the map from task 2, looks up the allowed set from task 1, and returns `{ behavior: 'deny', message: '...' }` for tools not in that set; when `agentID` is undefined (main session context), the callback returns `{ behavior: 'allow' }`; a `console.error()` line (not `console.log()`) is emitted on every deny for observability.

### Research needed

- **`bypassPermissions` vs `canUseTool` interaction:** Does `permissionMode: 'bypassPermissions'` on the `query()` call suppress or override the `canUseTool` callback entirely? If so, either `permissionMode` must be changed (and its consequences understood) or `canUseTool` will be a no-op. The researcher must verify the SDK source or docs before task 3 is coded.
- **`agentID` reliability in `canUseTool` options:** Is `agentID` always present in the `canUseTool` options when the call originates from a subagent, or only sometimes? Are there tool calls from the main orchestrator that arrive with a non-undefined `agentID`? The researcher must confirm the exact SDK contract before task 2 and 3 are coded.
- **Stream message shape for subagent tracking:** What is the exact SDK message type and field names that carry agent ID → agent type during subagent spawning? Confirm whether the `hooks/subagent-start.js` mapping approach (agent_id → agent_type in `run-active.json`) is the right signal source, or whether the `query()` stream provides this directly and is preferable.

### Approach summary

- Decision: Wire `canUseTool` into the existing `query()` call in `forge-worker.mjs`, driven by a startup-parsed frontmatter tool map and a runtime agent-ID-to-type tracker.
- Trade-off: Enforcement only applies inside the `forge-worker.mjs` query session — agents invoked outside the worker (e.g. conductor direct calls) remain unenforced.
- Uncertainty: Whether `bypassPermissions` silently disables `canUseTool` is a blocking unknown; the plan cannot be implemented until this is resolved.

---

### Feature: Critic pipeline redesign — phases 2-4 (focus-area steering, architecture lens, dead-code pre-scan)

Summary: Ship critic phases 2-4: make focus-area steering work end-to-end, add architecture challenge lens, add deterministic dead-code pre-scan. Phase 1 (citation grounding) already shipped — commit a38ea57. Phase 5 (multi-model debate) deferred.

## Phase 2 — Focus-area steering

- [ ] 1. Extend critic Step 1 to read per-invocation context from `docs/context/critic-session.json` (`agents/critic.md`)
  Intent: Give the critic a single stable location to receive per-invocation inputs (focus area, file scope) so scanning heuristics yield to injected context rather than ignoring it.
  Verify: AC-1: The critic prompt reads `docs/context/critic-session.json` at Step 1 if present; when `focusArea` is set the critic confines Step 2 scanning to files/modules matching it; when `focusFiles` is set Step 2 reads those files instead of running glob heuristics; absent file = current behavior preserved.
- [ ] 2. Update ideate skill to write `docs/context/critic-session.json` before dispatching critic (`skills/ideate/SKILL.md`)
  Depends: 1
  Intent: Thread the user-supplied focus argument into the critic invocation deterministically via file rather than prompt-prefix injection, which the critic currently ignores.
  Verify: AC-2: Before dispatching the critic agent the ideate skill writes `docs/context/critic-session.json` with `focusArea` (from `ARGUMENTS` if present, else null) and `focusFiles` (empty array); the "Focus your analysis on:" prompt-prefix line is removed and replaced by the file-read contract from task 1; when no argument is given the file is still written with null values so the critic sees a consistent contract.

## Phase 3 — Architecture challenge lens

- [ ] 3. Add Lens F — architecture challenge — to critic agent (`agents/critic.md`)
  Depends: 1
  Intent: Surface expensive-to-reverse architectural decisions by forcing a structured five-step challenge format before rendering a verdict, distinct from the existing fragility lens.
  Verify: AC-3: The critic prompt includes a new lens (Lens F — Architecture challenge) with exactly five structured steps: (1) state the decision, (2) strongest argument FOR, (3) attack ("breaks when"), (4) required invariant, (5) verdict of DEFENSIBLE or FRAGILE; findings use `"lens": "architecture-challenge"`; existing five lenses are unchanged; total findings cap of 10 still applies across all six lenses.

## Phase 4 — Dead code pre-scan

- [ ] 4. Build deterministic dead-code pre-scan script (`scripts/dead-code-scan.mjs`) (wave: 1)
  Intent: Produce a machine-verified list of dead exports and orphaned files before the critic runs so the LLM triages facts rather than independently discovers them.
  Verify: AC-4: Script detects whether a supported static-analysis tool is available, runs it if present, otherwise falls back to import-graph traversal; writes `docs/context/pre-scan-findings.json` with a structured array of `{ file, symbol, reason }` entries; exits cleanly with an empty array when no dead code is found; makes no LLM calls.

- [ ] 5. Wire pre-scan results into critic Step 1 and technical-debt lens (`agents/critic.md`) (wave: 2)
  Depends: 4
  Intent: Prevent the critic from re-discovering dead code via LLM intuition by feeding pre-scan results as ground truth that the technical-debt lens validates rather than independently asserts.
  Verify: AC-5: The critic Step 1 reads `docs/context/pre-scan-findings.json` if present and holds results in context; the technical-debt lens references pre-scan entries when emitting dead-code findings rather than asserting dead code independently; when the pre-scan file is absent the technical-debt lens behaves as today.

- [ ] 6. Update ideate skill to run dead-code pre-scan before dispatching critic (`skills/ideate/SKILL.md`) (wave: 2)
  Depends: 4
  Intent: Ensure pre-scan output is always fresh at critic dispatch time so the critic never operates on stale dead-code data.
  Verify: AC-6: The ideate skill runs the pre-scan script (task 4) before invoking the critic agent; if the script exits non-zero the skill logs a warning and proceeds without pre-scan data; the run is not aborted by a pre-scan failure.

### Research needed

- **Knip availability detection:** Confirm whether `knip` can be detected via `package.json` devDependencies or a local `node_modules/.bin` check, and what the correct fallback import-graph traversal looks like for a plain Node.js/ESM project. Check `scripts/` for existing traversal patterns before building new ones.
- **`critic-session.json` race condition:** If two ideate runs execute simultaneously (possible in multi-worktree), they would overwrite the same `docs/context/critic-session.json`. Confirm whether the ideate pipeline has a single-run guard or whether the session file should be namespaced by run ID.
- **`agents/critic.md` prompt-size budget:** GENERAL.md does not list a size threshold for agent files. Confirm whether adding Lens F plus Step 1 additions to `agents/critic.md` keeps within any implicit prompt-size budget given `maxTurns: 25`.

### Approach summary

- Decision: Use `docs/context/critic-session.json` as the per-invocation context file for Phase 2 rather than `criticConfig` in `project.json`, deferring the composable-lens redesign (TODO 95f9518b) to a future phase; this ships focus-area steering without schema changes to `project.json`.
- Trade-off: Focus-area steering requires a two-file change (ideate skill writes session file, critic reads it), but prompt-prefix injection (current approach) is demonstrably ignored by the critic's Step 2 heuristics.
- Uncertainty: The composable-lens approach (TODO 95f9518b) may supersede Phase 2 entirely; if prioritised first, tasks 1-2 can be dropped and only phases 3-4 (tasks 3-6) need to land.
---

### Feature: Wire per-phase execution loop into implement skill

Summary: Extend the implement skill and forge_update_run tool to detect PLAN.md phase headings and run the coder+reviewer pipeline once per phase with per-phase worktree commits.

- [ ] 1. Extend forge_update_run inputSchema and handler with phases array merge-by-index (`mcp/server.js`)
  Intent: Allow the implement skill to write per-phase status incrementally without replacing the full phases array, mirroring the existing stages merge-by-key pattern.
  Verify: AC-1: The forge_update_run inputSchema accepts a `phases` field as an array of PhaseEntry-shaped objects; when `phases` is provided the handler merges entries by `index` field (last-write-wins on collision) into the stored array rather than replacing it; when the stored `phases` is null the provided value initialises it.

- [ ] 2. Add phase detection and per-phase execution loop to implement skill (`skills/implement/SKILL.md`)
  Depends: 1
  Intent: Make the implement worker loop the full coder pipeline once per phase when the active feature plan contains phase headings, committing to the worktree branch after each phase passes.
  Verify: AC-2: When `docs/PLAN.md` contains one or more `## Phase N` headings under the active feature section, the worker runs Steps 2b through 5c once per phase in order, scoping each agent to only that phase's task lines; a BLOCK verdict stops the loop and marks that phase as blocked; a REVISE-unresolved continues to the next phase; a worktree git commit is created after each passing phase; when no phase headings are present the skill proceeds identically to the current single-pass flow.

- [ ] 3. Update Gate #2 presentation to summarise per-phase verdicts (`skills/implement/SKILL.md`)
  Depends: 2
  Intent: Give the user a clear per-phase overview at Gate #2 so they can see which phases passed, which were blocked, and which commits were written before approving or discarding.
  Verify: AC-3: The Gate #2 summary lists each phase by number and label with its reviewer verdict and whether a worktree commit was written; a BLOCKED phase is prominently flagged with the blocking reason; single-phase (non-partitioned) runs show no phase table and their Gate #2 presentation is unchanged from today.

### Approach summary

- Decision: Two-file change — extend `mcp/server.js` forge_update_run handler for phases array merge, then update `skills/implement/SKILL.md` with phase-detection and loop logic wrapping Steps 2b–5c; no new scripts or MCP tools needed.


### Feature: run.agents wholesale-replace regression fix

Summary: Fix the regression where `run.agents` is wholesale-replaced instead of merged by `agentId` when hooks call `updateRun` core directly.

**Problem statement:** When agents complete, `run.agents` in the run registry (`run.json`) ends up containing only the most recently finished agent instead of accumulating all dispatched agents. Earlier agent records are erased. The `forge_update_run` MCP tool's handler implements correct merge-by-agentId logic (`mcp/server.js` lines 2101–2112), but `hooks/subagent-stop.js` (line 327) calls `updateRunCore` from `packages/forge-core/src/runs/updateRun.js` directly — bypassing the MCP handler entirely. `updateRun.js` line 24 uses a shallow spread (`{ ...raw, ...patch, updatedAt: now }`) which wholesale-replaces the `agents` array with whatever is in `patch.agents`. The merge logic in the MCP handler is never reached.

Research confirmed all three suspected mechanisms — see `docs/RESEARCH/run-agents-wholesale-replace.md` for full evidence. Key findings:
- **Q1 (concurrent hook timing):** SDK source is external; serialisation cannot be confirmed from in-repo evidence. Conservative answer is to assume concurrent SubagentStop hooks are possible — task 4 (run-file lock) stays.
- **Q2 (`registryAgents` payload scope):** `data.agents` is the FULL run-active.json array (all agents started so far), not the single stopping agent. After the core merge fix this would be idempotent but carries an ordering risk because `subagent-start.js` writes `run-active.json` and `subagent-stop.js` reads it — a fast-stopping agent could miss a later `start` write. Recommendation: tighten the stop hook to pass only the single stopping agent's record.
- **Out-of-scope follow-up:** `hooks/subagent-start.js` line 219 has the same shallow-spread problem for `stages` — single-key patches wholesale-replace the full stages map. Not in scope for this fix; flagged for a future task.

**Suspected mechanisms:**
- `packages/forge-core/src/runs/updateRun.js` line 24 — shallow spread replaces `agents` wholesale; no merge-by-agentId logic present in the core function.
- `hooks/subagent-stop.js` line 327 — calls `updateRunCore(projectDir, data.runId, { agents: registryAgents })` directly via ESM dynamic import of the core module, bypassing the `forge_update_run` MCP handler where merge logic lives.
- `hooks/subagent-start.js` line 219 — also calls `updateRun` core directly for `stages` dual-write; same shallow-spread path, but `stages` is a record-merge not an array and uses a different merge key (`key` in stages vs `agentId` in agents), so the symptom differs.
- `packages/forge-core/src/runs/storage.js` — `writeJson` uses atomic temp-rename (line 39–41); no file-level locking for the run.json file itself. Concurrent writes from simultaneous hook invocations could produce lost updates independently of the merge issue.

- [ ] 1. Add merge-by-agentId logic to `updateRun` core (`packages/forge-core/src/runs/updateRun.js`)
  Intent: Make the core `updateRun` function merge `agents` arrays by `agentId` (upsert) rather than replacing them wholesale, so all callers — including hooks that bypass the MCP layer — get correct accumulation behaviour.
  Verify: AC-1: When `patch.agents` is provided, `updateRun` reads the existing `agents` array from `raw`, builds a merge map keyed by `agentId`, upserts each incoming entry, and writes the merged array back; existing records whose `agentId` is absent from the patch are preserved; a null/absent existing array is initialised from the patch; the shallow spread for all other fields is unchanged.

- [ ] 2. Remove redundant agents merge from `forge_update_run` MCP handler (`mcp/server.js`)
  Depends: 1
  Intent: Eliminate the duplicate merge-by-agentId block in the MCP handler now that the core function handles it correctly, so the merge logic has a single authoritative location.
  Verify: AC-2: The agents merge block in `mcp/server.js` (lines 2101–2112) is removed; calls to `forge_update_run` with an `agents` payload still produce correct merge-by-agentId output (via the core function from task 1); existing MCP handler behaviour for all other fields is unchanged.

- [ ] 3. Tighten `subagent-stop.js` payload to single stopping agent record (`hooks/subagent-stop.js`)
  Depends: 1
  Intent: Make the stop hook upsert only the single stopping agent's record rather than re-passing the full `data.agents` array each call, eliminating the run-active.json ordering dependency and making the upsert semantically precise (research recommendation — see `docs/RESEARCH/run-agents-wholesale-replace.md` Q2).
  Verify: AC-3: `hooks/subagent-stop.js` extracts the single agent entry whose `agent_id` matches the stopping agent's ID from the hook payload (the `agent_id` field already available at line 290–325) and passes `{ agents: [singleEntry] }` to `updateRunCore` instead of the full `registryAgents` array; if no matching entry exists in `data.agents` the hook logs a warning and skips the registry update rather than passing the full array; after the fix, successive stop-hook calls each upsert exactly one record into `run.json`, and earlier agents' records are preserved by the core merge logic from task 1.

- [ ] 4. Add per-run-file write lock to `storage.js` (`packages/forge-core/src/runs/storage.js`)
  Intent: Prevent lost-update races where two concurrent hook invocations read-modify-write `run.json` simultaneously and one overwrites the other's changes, independent of the merge-logic fix. SDK serialisation of SubagentStop hooks is unconfirmed (research Q1) — the lock is the conservative defence.
  Verify: AC-4: A new `withRunLock(projectRoot, runId, fn)` wrapper is added to `packages/forge-core/src/runs/storage.js` that mirrors the existing `withIndexLock` spin-lock pattern (lines 44–66) — same `openSync(lockPath, 'wx')` exclusive-create with retry/backoff, lock path is `runPath(projectRoot, runId) + '.lock'`; `updateRun` core wraps its read-modify-write block in `withRunLock` so concurrent writers serialise on the same `run.json` path; existing `withIndexLock` usage and the index-lock path are unchanged; when two writes race against the same run, the second waits and both updates are reflected in the final file.

### Research needed

- **Concurrent hook timing:** Confirm whether SubagentStop hooks for multiple agents can fire simultaneously within a single pipeline run (e.g., parallel reviewer completion). If they cannot overlap (SDK serialises hook invocations), task 4 (run-file locking) may be unnecessary. Researcher should check SDK dispatch model for concurrent SubagentStop.
- **`registryAgents` payload scope in subagent-stop.js:** The hook at line 318–325 maps `data.agents` (entire run-active.json agents array, all agents so far) into `registryAgents` and passes the full array to `updateRunCore`. After the core fix (task 1), this means every stop call will attempt to upsert all previously-completed agents again. Confirm whether this is correct behaviour (idempotent upserts are safe) or whether the hook should pass only the single stopping agent's record.

### Approach summary

- Decision: Fix the core `updateRun` function to implement merge-by-agentId, then remove the now-redundant duplicate merge from the MCP handler. The fix is scoped to `packages/forge-core/src/runs/updateRun.js` and `mcp/server.js` only.
- Trade-off: Moving merge logic into the core means all callers get correct behaviour without needing to know about merge semantics — but it also means the MCP handler's existing merge block becomes dead code and must be removed to avoid confusion.
- Uncertainty: Whether a run-file write lock (task 4) is actually needed depends on whether the SDK can fire concurrent SubagentStop hooks — researcher to confirm before task 4 is implemented.

---

### Feature: Per-run reviewer-output directory

Summary: Move reviewer verdict files from the shared `docs/context/reviewer-output/` to per-run `.pipeline/runs/<runId>/reviewer-output/` to eliminate concurrent-worker race conditions.

#### Phase 1 — Reviewer agents and style-check script

- [x] 1. Update reviewer agents to write to a prompt-injected output dir (`agents/reviewer-safety.md`, `agents/reviewer-boundary.md`, `agents/reviewer-logic.md`, `agents/reviewer-performance.md`) (wave: 1)
  Intent: Make each reviewer agent resolve its output path from a `[reviewer-output-dir: <path>]` prefix injected by the skill rather than a hardcoded constant, so concurrent runs write to isolated per-run directories.
  Verify: AC-1: Each reviewer agent reads the `[reviewer-output-dir: <path>]` line from its prompt when present and writes its verdict file to that path; when the prefix is absent the agent falls back to `docs/context/reviewer-output/` so existing direct invocations are unaffected; the verdict filename (e.g. `reviewer-safety.md`) is unchanged.

- [x] 2. Update `scripts/reviewer-style-check.mjs` to accept and use a `--output-dir` flag (`scripts/reviewer-style-check.mjs`) (wave: 1)
  Intent: Give the deterministic style-check script a per-run output directory so its verdict file lands alongside the LLM reviewer outputs rather than in the shared directory.
  Verify: AC-2: The script accepts a `--output-dir=<path>` CLI flag; when provided it writes `reviewer-style.md` to that directory instead of `docs/context/reviewer-output/`; when absent it falls back to the existing path so callers without the flag are unaffected; the directory is created if absent.

#### Phase 2 — Skill updates (implement, debug, refactor, plan)

- [x] 3. Update implement skill to create per-run dir and inject path into reviewer dispatch (`skills/implement/SKILL.md`) (wave: 1)
  Intent: Make the implement skill own the per-run reviewer-output directory lifecycle — create it, inject its path when dispatching reviewers and the style-check script, read verdicts from it, and clear it between phases.
  Verify: AC-3: Before reviewer dispatch the skill creates `.pipeline/runs/<runId>/reviewer-output/` (using the runId from Step 1); passes `[reviewer-output-dir: .pipeline/runs/<runId>/reviewer-output/]` as a prompt prefix to each reviewer agent; passes `--output-dir=.pipeline/runs/<runId>/reviewer-output/` to `reviewer-style-check.mjs`; reads verdict files from that dir; clears only that dir between phases.

- [x] 4. Update debug skill to use per-run reviewer-output dir (`skills/debug/SKILL.md`) (wave: 1)
  Intent: Apply the same per-run isolation to the debug pipeline so debug reviewer verdicts do not collide with concurrent implement or plan runs.
  Verify: AC-4: The debug skill creates `.pipeline/runs/<runId>/reviewer-output/`, injects the dir path into reviewer and style-check dispatch, and reads verdicts from that dir; the shared `docs/context/reviewer-output/` is not read or written by the debug skill.

- [x] 5. Update refactor skill to use per-run reviewer-output dir (`skills/refactor/SKILL.md`) (wave: 1)
  Intent: Apply the same per-run isolation to the refactor pipeline so refactor reviewer verdicts do not collide with concurrent runs.
  Verify: AC-5: The refactor skill creates `.pipeline/runs/<runId>/reviewer-output/`, injects the dir path into reviewer and style-check dispatch, and reads verdicts from that dir; the shared `docs/context/reviewer-output/` is not read or written by the refactor skill.

- [x] 6. Update plan skill to use per-run reviewer-output dir and remove stale-file pre-delete (`skills/plan/SKILL.md`) (wave: 1)
  Intent: Eliminate the pre-review `find … -delete` workaround in the plan skill (which races concurrent workers) by switching to a fresh per-run directory that is always empty at creation time.
  Verify: AC-6: The plan skill creates `.pipeline/runs/<runId>/reviewer-output/` before dispatcher invocation; injects the dir path into each reviewer's prompt prefix; removes the `find docs/context/reviewer-output -name '*.md' -delete` Bash step; reads verdicts from the per-run dir.

#### Phase 3 — Lifecycle, permissions, and shared-dir removal

- [ ] 7. Update `scripts/post-apply-lifecycle.mjs` to archive from per-run dir (`scripts/post-apply-lifecycle.mjs`) (wave: 1)
  Intent: Make the post-apply lifecycle script archive reviewer verdicts from the per-run directory rather than the now-defunct shared directory, preserving the review-archive trail.
  Verify: AC-7: `archiveReviewerOutput()` resolves the runId from its invocation context and uses `.pipeline/runs/<runId>/reviewer-output/` as the source dir; when the per-run dir is absent it logs and skips (same as today for the shared dir); the archive destination `.pipeline/review-archive/<ts>/` is unchanged.

- [ ] 8. Update `.pipeline/agent-roles.json` allowedPaths for reviewer and documenter agents (`.pipeline/agent-roles.json`) (wave: 1)
  Intent: Grant reviewer agents write permission to the new per-run path and remove the now-invalid shared-dir allowance so `ctx-pre-tool.js` enforces correct boundaries.
  Verify: AC-8: Each reviewer entry in `agent-roles.json` has `allowedPaths` updated from `["docs/context/reviewer-output/**"]` to `[".pipeline/runs/**"]`; the documenter entry is updated similarly; no additional code changes to `ctx-pre-tool.js` are needed.

- [ ] 9. Update `agents/coder.md` revision-step reference to reviewer-output dir (`agents/coder.md`) (wave: 1)
  Intent: Keep the coder's revision protocol in sync with the new per-run path so it does not attempt to read from the deleted shared directory during revision loops.
  Verify: AC-9: The coder revision step is updated to read the blocking reviewer's output from the path provided in its prompt context rather than a hardcoded `docs/context/reviewer-output/`; the hardcoded reference is removed or qualified with a fallback note.

- [ ] 10. Delete shared `docs/context/reviewer-output/` directory and update `scaffolds/code/CLAUDE.md` (`docs/context/reviewer-output`, `scaffolds/code/CLAUDE.md`) (wave: 2)
  Depends: 1, 2, 3, 4, 5, 6, 7, 8, 9
  Intent: Remove the shared directory once all consumers have migrated to per-run paths, and update the scaffold reference so new projects inherit the correct path convention.
  Verify: AC-10: `docs/context/reviewer-output/` directory is deleted from the repo; `scaffolds/code/CLAUDE.md` reference is updated to `.pipeline/runs/<runId>/reviewer-output/`; no remaining file in `agents/`, `skills/`, or `scripts/` references the old path as a write target.

### Research needed

- **`post-apply-lifecycle.mjs` runId sourcing:** The script currently receives `featureName` as its only CLI argument. Confirm how it can reliably resolve the `runId` at apply time — options are: (a) pass `runId` as a second CLI arg from the apply skill, (b) read `run-active.json` at script startup. Confirm which invocation form `skills/apply/SKILL.md` uses and whether adding a second positional arg is backward-compatible.

### Approach summary

- Decision: Store per-run reviewer output at `.pipeline/runs/<runId>/reviewer-output/`; inject the path into reviewer agents via a `[reviewer-output-dir: <path>]` prompt prefix controlled by each skill; delete the shared `docs/context/reviewer-output/` once all consumers migrate.
- Trade-off: Prompt-prefix injection means agents carry the path in context rather than discovering it from the filesystem — a reviewer invoked without the prefix falls back to the old path, so direct manual invocations still work. Per-run dirs accumulate under `.pipeline/runs/` and are not auto-pruned by this feature (pruning is an existing lifecycle concern).
- Uncertainty: How `post-apply-lifecycle.mjs` resolves the runId at invocation time — researcher to confirm the apply skill's invocation contract before task 7 is coded.

---

### Feature: bash-guard read-vs-write distinction for node -e on .pipeline/ paths

Summary: Allow `node -e` invocations that only read `.pipeline/` files to pass bash-guard; block only those that write or mutate.

- [ ] 1. Add read-only fs operation detector to `hasBashWriteVector` (`hooks/bash-guard.js`)
  Intent: Replace the blanket `node -e` block with a write-operation check so read-only inspections of `.pipeline/` state via inline Node scripts are no longer blocked.
  Verify: AC-1: `hasBashWriteVector` returns false for `node -e` commands whose inline script contains only read-only fs calls (`readFileSync`, `readFile`, `existsSync`, `statSync`, `readdirSync`, `JSON.parse`, `console.log`/`console.error`) and references `.pipeline/`; returns true for commands containing any write/mutate call (`writeFileSync`, `appendFileSync`, `unlinkSync`, `rmSync`, `mkdirSync`, `renameSync`, `chmodSync`, `copyFileSync`) alongside `.pipeline/`.

- [ ] 2. Add unit tests for the read/write node -e distinction (`hooks/bash-guard.test.js`)
  Intent: Provide regression coverage so future guard changes cannot silently re-block read-only `node -e` or silently unblock mutating ones.
  Verify: AC-2: Test file covers at minimum: (a) `node -e` with `readFileSync` + `.pipeline/` path passes; (b) `node -e` with `writeFileSync` + `.pipeline/` path blocks; (c) `node -e` with `unlinkSync` + `.pipeline/` path blocks; (d) `node -e` with no `.pipeline/` reference passes unchanged; (e) `node -p` (--print flag) read-only passes; (f) `node -e` with mixed read+write calls blocks (write wins); all existing bash-guard test cases continue to pass.

### Research needed

None.

### Approach summary

- Decision: Narrow `hasBashWriteVector`'s `node -e` arm to check whether the inline script body contains a write/mutate fs method before blocking; commands with no write methods are allowed through. Read-only allow-list is the safer direction (explicit list of safe calls) rather than a block-list (deny all except listed writes), because new unknown methods default to blocked.
- Trade-off: Regex-based method detection on the inline script body can be fooled by variable indirection (`const fn = fs['writeFile' + 'Sync']`) — acceptable risk because the guard is a speed-bump, not a security boundary; the MCP tool layer remains the authoritative control.
- Uncertainty: Whether `node --eval` and `node --print` long-form flags already appear in agent-generated commands and need the same treatment — the existing pattern already matches them (`-e|-p|--eval|--print`), so the fix applies uniformly.

---

### Feature: approval-token.js false-positives from system-reminder context

Summary: Fix two defects in `hooks/approval-token.js` that cause false-positive token writes triggered by injected system-reminder context and substring negation matches.

**Problem (two defects):**

1. `extractUserMessage()` (lines 57–84): returns `payload.prompt` verbatim. Claude Code injects `<system-reminder>…</system-reminder>` blocks into the prompt string. These blocks contain words like `approve`, `commit`, and `push` (visible in `CLAUDE.md` and other injected context). The keyword scan reads this injected context, not user intent.

2. `isNegated()` (lines 44–48): uses `.includes()` substring matching against an 80-character lookback. The token `"no"` matches inside `"note"`, `"none"`, `"diagnose"`, `"north"` etc., causing spurious negation suppression. No word-boundary anchoring is applied.

**Note on stale test:** `hooks/approval-token-test.mjs` lines 32–40 assert that `ACTION_KEYWORDS['gate-approve']` is an array of 11 keywords. The hook source (lines 30–34) defines it as the single string `'approve'`. The test must be corrected to match — the gate-approve keyword set must NOT be broadened; the test must be narrowed.

- [x] 1. Add `stripInjectedContext()` and call it inside `extractUserMessage()` (`hooks/approval-token.js`)
  Intent: Remove Claude Code injected blocks from the extracted message before keyword scanning so system-reminder text cannot trigger false-positive approvals.
  Verify: AC-1: `extractUserMessage()` strips all `<system-reminder>…</system-reminder>` blocks from the returned string in every fallback shape using the exact regex `/<system-reminder>[\s\S]*?<\/system-reminder>/gi` (non-greedy, case-insensitive, global; `[\s\S]*?` is used in place of the `s` dotAll flag for cross-Node-version safety); unclosed/truncated `<system-reminder>` tags (no closer) are LEFT IN the message — the regex simply won't match them, which is acceptable because action keywords inside an unclosed truncation are rare and the alternative (greedy match) risks gutting legitimate user text; a message whose only action keyword appears inside a system-reminder block produces no detected actions; a message with an action keyword outside system-reminder blocks still detects correctly; CRLF (`\r\n`) and LF (`\n`) line endings inside the block are both stripped (the `[\s\S]` class matches both).

- [x] 2. Rewrite `isNegated()` to use word-boundary regex matching (`hooks/approval-token.js`)
  Intent: Prevent substring false-matches (e.g. `"no"` inside `"note"`, `"none"`) from incorrectly suppressing legitimate action keywords.
  Verify: AC-2: Each negation token is matched via a regex compiled ONCE at module scope (hoisted constant `NEGATION_REGEXES`, not re-compiled per call) — confirmed via verification step that the array literal lives at module top-level alongside `ACTION_KEYWORDS`. Exact patterns:
    - Single-word tokens (`no`, `stop`, `cancel`, `never`, `avoid`): `\b<word>\b` with case-insensitive flag.
    - Apostrophe token `don't`: literal pattern `\bdon't\b` with case-insensitive flag (the apostrophe sits between two word characters, so `\b` correctly anchors at `d` and `t`).
    - Multi-word phrase `do not`: pattern `\bdo\s+not\b` with case-insensitive flag (allows multiple whitespace characters between the words).
  The 80-character lookback window is retained (rationale at `hooks/approval-token.js:39–43`); `"note"`, `"none"`, `"diagnose"`, `"north"` in the lookback do NOT suppress detection of an action keyword that follows them; `"don't approve"` and `"do  not commit"` (double space) still suppress correctly.

- [x] 3. Update `hooks/approval-token-test.mjs` with new test cases and fix stale gate-approve assertion (`hooks/approval-token-test.mjs`)
  Intent: Prove both fixes hold under regression and align the test file with the current single-`'approve'` gate-approve policy.
  Verify: AC-3: The stale 11-keyword `gate-approve` array assertion (lines 32–40) is replaced with an assertion that `ACTION_KEYWORDS['gate-approve']` equals the string `'approve'`. New test cases pass:
    (a) a message whose `<system-reminder>` block contains `approve` does NOT produce a `gate-approve` detection (e.g. `"<system-reminder>type approve to confirm</system-reminder>"` → `[]`);
    (b) multiple `<system-reminder>` blocks in one message are ALL stripped (two blocks each containing a different action keyword → `[]`);
    (c) a `<system-reminder>` block containing `\r\n` line endings is still stripped correctly;
    (d) `"no"` embedded inside `"note"` or `"none"` in the lookback window does NOT suppress a following `commit` keyword (e.g. `"please note: commit"` → `["commit"]`);
    (e) `"don't approve"` continues to suppress `gate-approve` (returns `[]`);
    (f) `"don't commit"` continues to suppress `commit` (returns `[]`);
    (g) `"do not push"` and `"do  not push"` (double space) both suppress `push`;
    (h) a genuine `"no, don't commit"` prefix continues to suppress `commit`;
    (i) an action keyword OUTSIDE any system-reminder block is still detected when system-reminders are also present in the same message (e.g. `"<system-reminder>foo</system-reminder> please commit"` → `["commit"]`);
  All pre-existing passing test cases remain green.

### Risk

This hook fires on every user prompt. A regex defect in `stripInjectedContext` or `isNegated` has two failure modes: (a) over-strip — legitimate approval text removed, git commands blocked until the user rephrases; (b) under-strip or negation misfire — phantom tokens written, bash-guard lets unintended commit/push through. Both are caught by the test suite in task 3. Keep the full existing test suite green throughout.

### Verification

```
node --test hooks/approval-token-test.mjs
```

### Research needed

None. The `<system-reminder>` tag format is confirmed from the feature request and from the absence of any FORGE-produced occurrence in the repo (Claude Code itself injects it). The 80-character lookback window is retained — its rationale is documented at `hooks/approval-token.js` lines 39–43. Assumption: other Claude Code injection tags (e.g. `<context>`, `<memory>`) do not currently contain action keywords; if they do, the same strip pattern should be extended — flag as a follow-up.

### Approach summary

- Decision: Two targeted edits to `hooks/approval-token.js` (strip `<system-reminder>` blocks before scanning; word-boundary regex array hoisted to module scope for negation check) plus test corrections in `hooks/approval-token-test.mjs`.
- Trade-off: Stripping by tag name means a future Claude Code injection tag with a different name would not be caught; accepted because the fix targets the confirmed defect rather than speculating about future injection formats.
- Uncertainty: Whether Claude Code injects `<system-reminder>` into the fallback payload shapes (`payload.message.content`, `payload.user_prompt`) as well as `payload.prompt` — stripping is applied to all shapes as a precaution.

### Reviewer feedback incorporated (plan-stage REVISE round)

- **reviewer-logic:** specified exact strip regex (`/<system-reminder>[\s\S]*?<\/system-reminder>/gi`), explicit apostrophe-token handling (`\bdon't\b`), explicit multi-word phrase handling (`\bdo\s+not\b`), unclosed-tag behaviour, apostrophe test cases (e/f/g) added.
- **reviewer-performance:** AC-2 now explicitly requires hoisting the negation regex array to module scope (compiled once, not per call).
- **gotcha-checker:** AC-3 now includes a CRLF (`\r\n`) line-ending test case (test c) to satisfy GENERAL.md line 56 platform-equivalence requirement.

---

### Feature: BLOCK and REVISE-unresolved fail the run automatically

Summary: Change implement, debug, and refactor skills so BLOCK and REVISE-unresolved verdicts fail the run immediately instead of opening Gate #2.

**Goal:** Today when reviewers return BLOCK, or when the revision loop exhausts its iterations (`N >= 2`) leaving REVISE warnings unresolved, the pipeline writes a `gate-pending.json` and calls `forge_update_run({ status: "gate-pending" })` — putting the failure decision in the user's hands at Gate #2. The desired behaviour is the opposite: these are pipeline failures, not checkpoints. The run should be marked `status: "failed"` with a `failureReason` string, the gate file should not be written, and Gate #2 should only fire for clean outcomes (APPROVED or skipped reviewers). The user can still inspect the reviewer output in `.pipeline/runs/<runId>/reviewer-output/` after the failure.

**Current behaviour — file:line citations:**

*implement skill (`skills/implement/SKILL.md`):*
- Line 231: BLOCK in single-pass flow → writes `gate-pending.json` + calls `forge_update_run({ status: "gate-pending" })` (the blocked-gate path). Gate #2 fires.
- Line 237: REVISE `N >= 2` → "Fall through to Gate #2 with all accumulated REVISE warnings included in the gate presentation." Gate #2 fires.
- Line 140–142: Phase loop BLOCK → "Stop the phase loop immediately … Proceed to the completeness-checker (Step 3.3) and Gate #2."
- Line 144–146: Phase loop REVISE-unresolved → records phase status and continues to next phase; Gate #2 eventually fires at the end of the loop.

*debug skill (`skills/debug/SKILL.md`):*
- Line 123: BLOCK → same gate-pending path as implement.
- Line 129: REVISE `N >= 2` → "Fall through to Gate #2 with all accumulated REVISE warnings."

*refactor skill (`skills/refactor/SKILL.md`):*
- Line 125: BLOCK → same gate-pending path as implement.
- Line 131: REVISE `N >= 2` → "Fall through to Gate #2 with all accumulated REVISE warnings."

**"REVISE-unresolved" concept:** The term is used in the phase-loop context at `skills/implement/SKILL.md:144` (`status: "revise-unresolved"`) for per-phase tracking, and in the feature request to describe the single-pass `N >= 2` condition. There is no separate `REVISE-unresolved` reviewer verdict — it is a pipeline state, not a reviewer output token.

**Target behaviour:**
- BLOCK (any reviewer): call `forge_update_run({ status: "failed", failureReason: "reviewer BLOCK: <reviewer name> — <first line of block reason>" })`. Do NOT write `gate-pending.json`. Do NOT open Gate #2. Log the block reason and exit the worker.
- REVISE-unresolved (N >= 2 with remaining REVISE warnings): call `forge_update_run({ status: "failed", failureReason: "REVISE unresolved after 2 revision passes — <comma-joined unresolved AC-IDs>" })`. Do NOT open Gate #2. Log and exit.
- APPROVED (all reviewers approved): open Gate #2 normally (no change).
- Reviewers skipped: open Gate #2 normally (no change).

**MCP guard compatibility:** `mcp/server.js:2122` exempts `status: "failed"` from the gate-pending transition guard — the worker can call `forge_update_run({ status: "failed" })` even when the run is currently `gate-pending`. This means the skill change does not require any MCP layer change; the existing guard already allows the failure path.

- [x] 1. Replace BLOCK gate-path with run-failure in implement skill (`skills/implement/SKILL.md`)
  Intent: Make the single-pass BLOCK branch and the phase-loop BLOCK branch both fail the run instead of opening a blocked Gate #2, so the user sees a terminal failure card rather than a gate to approve.
  Verify: AC-1: In `skills/implement/SKILL.md` Step 5b, when any reviewer emits BLOCK, the skill calls `forge_update_run({ status: "failed", failureReason: "reviewer BLOCK: <reviewer> — <summary>" })` and exits without writing `gate-pending.json` or calling `forge_update_run({ status: "gate-pending" })`; the blocked gate-pending path (write `gate-pending.json` with `"blocked": true`) is removed from Step 5b; the same failure call replaces the phase-loop BLOCK branch at Step 2c.

- [x] 2. Replace REVISE-unresolved gate-path with run-failure in implement skill (`skills/implement/SKILL.md`)
  Intent: Make the `N >= 2` REVISE fallthrough fail the run instead of presenting Gate #2 with unresolved warnings, so exhausted revision loops surface as a terminal failure.
  Verify: AC-2: In `skills/implement/SKILL.md` Step 5b, the `N >= 2` branch calls `forge_update_run({ status: "failed", failureReason: "REVISE unresolved after 2 revision passes — <AC-IDs>" })` and exits; the "Fall through to Gate #2" text is removed; the phase-loop REVISE-unresolved branch (Step 2c) is updated to call `forge_update_run({ status: "failed", ... })` and stop the loop rather than continuing to the next phase.

- [x] 3. Replace BLOCK and REVISE-unresolved gate-paths with run-failure in debug skill (`skills/debug/SKILL.md`)
  Intent: Apply the same failure-on-bad-verdict rule to the debug pipeline so debug runs do not stall at Gate #2 on reviewer failures.
  Verify: AC-3: In `skills/debug/SKILL.md` Step 5b, the BLOCK branch calls `forge_update_run({ status: "failed", failureReason: "reviewer BLOCK: <reviewer> — <summary>" })` and exits without writing `gate-pending.json`; the `N >= 2` REVISE branch calls `forge_update_run({ status: "failed", failureReason: "REVISE unresolved after 2 revision passes — <AC-IDs>" })` and exits; no Gate #2 is opened for either case.

- [x] 4. Replace BLOCK and REVISE-unresolved gate-paths with run-failure in refactor skill (`skills/refactor/SKILL.md`)
  Intent: Apply the same failure-on-bad-verdict rule to the refactor pipeline so refactor runs do not stall at Gate #2 on reviewer failures.
  Verify: AC-4: In `skills/refactor/SKILL.md` Step 4b, the BLOCK branch calls `forge_update_run({ status: "failed", failureReason: "reviewer BLOCK: <reviewer> — <summary>" })` and exits without writing `gate-pending.json`; the `N >= 2` REVISE branch calls `forge_update_run({ status: "failed", failureReason: "REVISE unresolved after 2 revision passes — <AC-IDs>" })` and exits; no Gate #2 is opened for either case.

### Research needed

None. The `forge_update_run` MCP handler at `mcp/server.js:2122` already exempts `status: "failed"` from the gate-pending transition guard, so no MCP changes are needed. The `failureReason` field is already defined in the `forge_update_run` inputSchema at `mcp/server.js:2018`.

### Risk surface

- `skills/implement/SKILL.md` — pipeline orchestration; changes affect the review verdict handling section and the phase-loop verdict handling section.
- `skills/debug/SKILL.md` — same verdict handling section.
- `skills/refactor/SKILL.md` — same verdict handling section.
- No schema changes, no MCP tool changes, no hook changes, no script changes.

### Test plan

Manual reproduction:
1. Run a feature through `/forge:implement` where the reviewer emits BLOCK. Confirm the run card shows `status: "failed"` (not `gate-pending`). Confirm no gate-pending.json was written in the worktree.
2. Run a feature where the coder fails to resolve REVISE warnings across two revision passes. Confirm the run card shows `status: "failed"` after the second revision pass.
3. Run a feature where all reviewers emit APPROVED. Confirm Gate #2 still fires normally.
4. Run a feature where reviewers are skipped (classifier returns empty list). Confirm Gate #2 still fires normally.

No automated test changes required — the MCP gate-pending guard and `status: "failed"` exemption are already tested in `mcp/gate-pending-guard-test.mjs`.

### Out of scope

- Changing the reviewer verdict vocabulary (`BLOCK`, `REVISE`, `APPROVED`) — unchanged.
- Refactoring the revision loop logic — the 2-pass cap and revision protocol are unchanged.
- Adding a user-override mechanism to bypass the auto-fail — intentionally not included; the user can re-trigger the pipeline after fixing the underlying issue.
- Changing what happens when reviewers are skipped — unchanged (Gate #2 fires).
- Changing Gate #2 for APPROVED runs — unchanged.
- The plan-stage review path in `skills/plan/SKILL.md` — plan-stage reviewers are advisory only and do not drive a Gate #2 verdict; out of scope.

### Approach summary

- Decision: Three skill-file edits (implement, debug, refactor) replacing the blocked-gate and REVISE-fallthrough branches with `forge_update_run({ status: "failed", failureReason: "..." })` calls; no MCP, hook, or script changes needed because the `status: "failed"` path is already supported and guard-exempt.
- Trade-off: The user loses the ability to `/forge:approve` past a BLOCK at Gate #2; they must fix the code and re-run. This is intentional — the feature request explicitly removes that escape hatch.
- Uncertainty: None. All relevant code paths are confirmed from file:line citations above.

---

### Feature: MCP guard inconsistency — forge_update_run gateState approval bypasses approval-token check

Summary: Close a gate self-approval bypass in `forge_update_run`: callers can write `gateState.status === "approved"` without a valid approval token, defeating the identical guard that `forge_set_gate` enforces. The fix is a single guard insertion mirroring the existing `forge_set_gate` check, plus two regression tests.

**Problem statement — code citations:**

`forge_set_gate` (`mcp/server.js` lines 813–822) guards every `status === "approved"` write:
```js
if (status === "approved") {
  if (!hasGateApprovalToken(projectDir)) {
    return errorResult("FORGE: Gate approval requires explicit user authorization. ...");
  }
}
```

`forge_update_run` (`mcp/server.js` lines 2149–2161) handles `gateState` writes with NO token check:
```js
if (cleanPatch.gateState) {
  const existing = getRun(projectDir, runId);
  if (existing && existing.feature) {
    cleanPatch.gateState = { ...cleanPatch.gateState, feature: existing.feature };
  }
}
```

A caller can therefore call `forge_update_run({ runId, gateState: { status: "approved", gate: "gate1", feature: "...", createdAt: "..." } })` to write an approved gate state without any token.

**Chain exploit:** The status-transition guard at `mcp/server.js` line 2130 reads `gateAlreadyApproved = existing.gateState && existing.gateState.status === 'approved'`. Once the bypass writes `gateState.status: "approved"`, a subsequent `forge_update_run({ status: "completed" })` passes the guard unconditionally — the entire gate enforcement chain collapses.

**Fix — insertion point:** Add the token check immediately before the canonical-feature-preservation block at line 2153 (inside the `if (cleanPatch.gateState)` block, before `existing` is read). Mirror the `forge_set_gate` error message verbatim.

- [ ] 1. Add approval-token guard for `gateState.status === "approved"` in `forge_update_run` (`mcp/server.js`)
  Intent: Close the gate self-approval bypass by checking `hasGateApprovalToken` whenever `forge_update_run` receives `gateState.status === "approved"`, mirroring the existing `forge_set_gate` guard.
  Verify: AC-1: Inside the `forge_update_run` handler at `mcp/server.js`, immediately before the `if (cleanPatch.gateState)` canonical-feature-preservation block (~line 2153), a new guard is inserted: `if (cleanPatch.gateState && cleanPatch.gateState.status === "approved" && !hasGateApprovalToken(projectDir)) { return errorResult("FORGE: Gate approval requires explicit user authorization. ..."); }` — the error message is identical to the `forge_set_gate` message at line 816–820; a call with `gateState.status === "approved"` and no token returns this error; a call with `gateState.status === "pending"` is unaffected; a call with no `gateState` is unaffected; a call with `gateState.status === "approved"` AND a valid token succeeds.

- [ ] 2. Add regression tests for the gateState bypass and its chain to `mcp/gate-pending-guard-test.mjs`
  Intent: Provide regression coverage for the direct bypass (writing `gateState.status: "approved"` without a token) and for the chain exploit (using a stored approved gateState to pass the status-transition guard).
  Verify: AC-2: Two new test scenarios are added to `mcp/gate-pending-guard-test.mjs`:
    (H) `forge_update_run` with `gateState: { status: "approved", ... }` and no action-approved.json token returns an error containing `"Gate approval requires explicit user authorization"` — BLOCKED.
    (I) Seed a run with `gateState.status: "approved"` written directly to `run.json` (simulating a pre-fix bypass), then call `forge_update_run({ status: "completed" })` — this scenario confirms the chain: with the fix applied, (H) blocks the bypass before the chain can be set up; without the fix, this would pass. Both (H) and (I) are marked BLOCKED. All pre-existing scenarios A–G remain green.

### Research needed

None. The bypass mechanism is confirmed by direct code inspection (`mcp/server.js` lines 813–822 vs 2149–2161). No new APIs, dependencies, or external contracts involved.

### Approach summary

- Decision: Single guard insertion in `forge_update_run` immediately before the `if (cleanPatch.gateState)` block at `mcp/server.js` ~line 2153. No schema changes. No hook changes. No new MCP tools.
- Trade-off: The guard is inserted *before* the canonical-feature-preservation read — it fires even if `gateState.feature` would be overwritten. This is the safest position: we block the bad call before touching stored state.
- Uncertainty: None. `hasGateApprovalToken` is defined at line 110, used at line 815 and line 2131 — adding a third callsite is a direct copy of the established pattern.
