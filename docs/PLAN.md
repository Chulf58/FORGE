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

- Decision: Extend the existing critic + ideate architecture (session-json injection, lens addition, pre-scan script) to deliver phases 2–4 incrementally.
- Trade-off: Dead-code pre-scan requires a static-analysis dependency or bespoke import traversal — fallback quality degrades on dynamic-require patterns.
- Uncertainty: Whether `critic-session.json` needs run-scoping for multi-worktree safety is unresolved.

---

### Feature: Per-worktree PLAN.md isolation + main-root cleanup

Summary: Ensure docs/PLAN.md is always written and read within the worktree, never the main project root, and clean up stale root copies.

## Discovery summary

Every code site that references `docs/PLAN.md`, with resolution analysis:

| File | Line(s) | Resolves relative to | Correct? |
|------|---------|---------------------|----------|
| `agents/planner.md` (this agent) | write instructions | worker cwd (worktree) | **Yes** — worker cwd IS the worktree |
| `agents/researcher.md` | 26 — reads `docs/PLAN.md` | worker cwd | **Yes** |
| `agents/coder.md` | 50, 80, 104 — reads | worker cwd | **Yes** |
| `agents/reviewer-*.md` (safety, boundary, logic, performance) | reads | worker cwd | **Yes** |
| `skills/plan/SKILL.md` | 123 — already documents worktree cwd | worker cwd | **Yes** |
| `skills/implement/SKILL.md` | 92 — explicit `<worktreePath>/docs/PLAN.md` | explicit worktree path | **Yes** |
| `skills/apply/SKILL.md` | 46, 100, 122 — reads/mentions | worker cwd | **Yes** |
| `skills/debug/SKILL.md` | 74 — example path | explicit worktree path | **Yes** |
| `skills/refactor/SKILL.md` | 74 — example path | explicit worktree path | **Yes** |
| `skills/discard/SKILL.md` | **39** — Step 3.2: "in the main project root — plans are not worktree-scoped" | **main project root** | **WRONG** |
| `scripts/reviewer-dispatch.mjs` | 203 — fallback `'docs/PLAN.md'` | **process.cwd()** at call time | **Conditionally wrong** — called from skill via `node scripts/...` in worktree; OK if conductor calls it from main root |
| `scripts/post-apply-lifecycle.mjs` | 318 — `path.join(projectDir, 'docs', 'PLAN.md')` where `projectDir = process.cwd()` | **process.cwd()** at invocation | **Conditionally wrong** — must be called from worktree, not main root |
| `scripts/completeness-check.mjs` | 228 — `path.join(root, 'docs', 'PLAN.md')` where `root` is passed by caller | caller-supplied | **Correct if caller passes worktree root** |
| `mcp/server.js` | 1681 — `join(projectDir, 'docs', 'PLAN.md')` where `projectDir = resolveProjectDir()` | **main project root** | **WRONG** — plan-existence check for `forge_create_run` hits main root, not any worktree |
| `hooks/subagent-stop.js` | 242–252 — `path.join(baseDir, 'docs/PLAN.md')` where `baseDir = data.worktreePath || projectDir` | worktreePath when set | **Correct** — uses worktreePath first |
| `hooks/doc-size-guard.js` | 48 — reads `filePath` as-is from tool payload | absolute path from tool call | **Correct** — tool payload carries the absolute path the agent used |
| `hooks/ctx-pre-tool.js` | 97 — reads manifest from `process.cwd()` | worker cwd | **Correct** — enforces relative to cwd |
| `packages/forge-core/src/runs/createWorktree.js` | 184–188 — copies entire `docs/` from main root into worktree | copies at worktree creation | **Correct** — seeds worktree from main at creation time |

**Root cause:** Two concrete defects exist:

1. **`skills/discard/SKILL.md` line 39** — instructs the conductor to remove the plan section from `docs/PLAN.md` in the **main project root** after a gate1 discard. Since plans now live in the worktree only, this removes nothing (or removes a stale copy), while leaving orphaned data in the root.

2. **`mcp/server.js` line 1681** — the `forge_create_run` plan-existence fallback check reads `<projectRoot>/docs/PLAN.md` (via `resolveProjectDir()`). When plans live in worktrees only, this check always fails for implement runs whose plan was written to a worktree branch and not yet merged.

**Secondary / informational:**

- `createWorktree.js` copies the full `docs/` directory from main root into the new worktree. This means any stale `docs/PLAN.md` sitting in the main root gets propagated into every new worktree — the stale plan becomes the starting point. Once the planner writes its own content on top, the stale sections persist as old `### Feature:` entries.

---

- [ ] 1. Fix discard skill — remove plan cleanup from main project root (`skills/discard/SKILL.md`)
  Intent: Plans now live only in the worktree branch; the discard skill must not reach into the main project root to remove a PLAN.md that is not there.
  Verify: AC-1: Step 3.2 in `skills/discard/SKILL.md` no longer references "main project root" for PLAN.md removal; the instruction either removes the step entirely (plan cleanup is handled by worktree deletion) or redirects it to delete the plan section from `<worktreePath>/docs/PLAN.md`.

- [ ] 2. Fix forge_create_run plan-existence check (`mcp/server.js`)
  Intent: The fallback PLAN.md existence check for implement runs must look in approved plan worktrees, not the main project root, so it does not false-negative after full worktree isolation.
  Verify: AC-2: When no gate1-approved plan run is found via `listRuns`, the file-exists fallback is skipped entirely — the gate1 approval status is the sole authority. The main-root path `join(projectDir, 'docs', 'PLAN.md')` is no longer used; the existence-check call site at `mcp/server.js:1681` is removed.

- [ ] 3. Clean stale PLAN.md from main project root (one-time cleanup task)
  Intent: Remove the orphaned `docs/PLAN.md` currently sitting in `C:\Users\cuj\forge-plugin\docs\` so worktree creation no longer seeds new worktrees from stale plan content.
  Verify: AC-3: `C:\Users\cuj\forge-plugin\docs\PLAN.md` is truncated to a minimal stub containing exactly `## Active Plan\n` (one heading line, one trailing newline); no `### Feature:` sections remain; the file is NOT deleted (other code may reference its existence as a path); no other files in `docs/` (GENERAL.md, ARCHITECTURE.md, DECISIONS.md, etc.) are modified or removed.

- [ ] 4. Add worktree-boundary guardrail to planner agent instructions (`agents/planner.md`)
  Intent: Prevent a future plan worker from accidentally writing docs/PLAN.md to the main project root by making the worktree-relative write contract explicit and machine-checkable.
  Verify: AC-4: `agents/planner.md` `### Always` section contains plain prose (no comment markers, no linter directives, no static-analysis hints) explicitly stating: when writing `docs/PLAN.md`, the absolute path of the file written must contain `.worktrees/<runId>/`, and the planner must verify this before calling Write. Plain prose is sufficient — no machine-parseable marker required.

- [ ] 5. Add PreToolUse guard script that blocks PLAN.md writes to main project root (`hooks/workflow-guard.js`)
  Intent: Fail fast at hook layer if a plan worker running in a worktree attempts to write docs/PLAN.md using a path that resolves outside the worktree, preventing silent main-root pollution.
  Verify: AC-5: New PLAN.md guard added to `hooks/workflow-guard.js` AS AN ADDITION (not a replacement) after the apply-gate block at approximately line 197. The guard fires for both `Write` AND `Edit` tool calls. Path resolution: read target path from `toolInput.file_path` with fallback to `toolInput.path` (matches `hooks/doc-size-guard.js:30` precedent); resolve relative paths against `process.cwd()` to absolute. Path normalization: lowercase + replace backslashes with forward slashes (matches `hooks/workflow-guard.js:165-172` precedent). Worktree detection: `process.cwd()` matches `.worktrees/<runId>/` where `<runId>` matches the existing `RUN_ID_RE` pattern at `hooks/workflow-guard.js:46` — bare substring match on `.worktrees/` is insufficient. Block condition: normalized target path ends with `docs/plan.md` AND cwd matches the worktree pattern AND target does not start with cwd → exit 2 with a descriptive error citing the offending path. Pass-through: writes to `<worktreePath>/docs/PLAN.md` pass; writes from main root (cwd has no `.worktrees/<runId>/` segment) pass.

- [ ] 6. Gitignore docs/PLAN.md and untrack from main (`.gitignore`)
  Intent: Prevent post-merge accumulation in the main project root. Each worktree's plan stays local to that worktree branch; merging the worktree branch back to main no longer carries PLAN.md into main's tracked tree. This closes the post-merge half of the leak that Tasks 1-5 do not address.
  Verify: AC-6: `.gitignore` contains a new entry `docs/PLAN.md` placed inside the "Plugin development state — NOT distributed to end users" block (currently lines 26-46, between `.pipeline/agent-roles.json` and `docs/PLAN-archive.md`). As part of Task 3 cleanup the conductor runs `git rm --cached docs/PLAN.md` so the file is no longer tracked. After this task lands, `git ls-files docs/PLAN.md` returns nothing in main, and future worktree merges do not re-add the file to the tracked tree.

- [ ] 7. Documenter snapshots completed plans to docs/solutions/plans/ (`agents/documenter.md`)
  Intent: Preserve historical plan content in the existing solutions store before each plan run's worktree-local PLAN.md is gone post-merge. Matches the existing pattern at `agents/documenter.md:152-153` which already writes 15-line solution files under `docs/solutions/<category>/`.
  Verify: AC-7: A new step is added to `agents/documenter.md` (after the existing solutions-write step at lines 150-160) that fires at apply stage. When the worktree's `docs/PLAN.md` contains an active `### Feature:` section, the documenter writes a snapshot to `docs/solutions/plans/<feature-slug>.md` containing: the feature heading, the summary line, and the completed task list (max 15 lines excluding frontmatter, per the documenter's existing solutions convention). `<feature-slug>` is kebab-case derived from the feature title. The snapshot is committed alongside the apply commit (Step 3c of `skills/apply/SKILL.md`). When PLAN.md has no active feature section (e.g. just the stub `## Active Plan\n`), the snapshot step is skipped without error.

### Research needed

- **`createWorktree.js` copy-on-create scope:** `docs/` is copied wholesale from main root into the new worktree at creation time (lines 184–188). After task 3 cleans the main root, new worktrees will receive a clean `docs/PLAN.md` stub. Confirm whether any other plan-stage artifacts in `docs/` (e.g. `docs/RESEARCH/`) are intentionally seeded from main, or whether only PLAN.md was the concern.
- **`post-apply-lifecycle.mjs` invocation context:** The script uses `process.cwd()` as `projectDir`. Verify whether the apply skill always invokes it from the worktree cwd — if so it resolves correctly; if the skill `cd`s to main root first, the PLAN.md cleanup in job 6 will silently operate on the wrong copy.

### Approach summary

- Decision: Fix the two concrete defects (discard skill, forge_create_run fallback), clean the main root once, and add an explicit guardrail so future plan workers cannot pollute the main root.
- Trade-off: The PreToolUse hook guard (task 5) adds a hook-layer check that fires on every Write/Edit during plan runs — negligible overhead but adds one more failure mode to the hook chain.
- Uncertainty: Whether `post-apply-lifecycle.mjs` is always called from the worktree cwd is unverified; flagged in Research needed.
