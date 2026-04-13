# Handoff: Run resume capability

## Overview

Shipped `/forge:resume` end-to-end: a backend MCP tool, a user-facing skill, and reference/changelog docs. Resume re-enters a paused or in-progress FORGE run by `runId` and restores the per-session steering pointer (`run-active.json`) — but does **not** progress the run autonomously, does **not** invoke any pipeline skill, and does **not** mutate the run's own `status` / `currentStep` / `gateState` / `agents`. After resume, the user (or the LLM on the next prompt) drives the next step.

## What shipped

### Backend (`mcp/server.js`)
- New tool `forge_resume_run({ runId })`. Normalizes runId (auto-prepends `r-`), runs four preconditions in order, and on success overwrites `.pipeline/run-active.json` with `{ startedAt, runId, pipelineType, mode, feature, agents: [], worktreePath? }`.
- Two new helpers near the existing helper block:
  - `pathsEqual(a, b)` — Windows-aware absolute-path equality used for the `projectRoot` precondition.
  - `PIPELINE_STAGE_LABELS` + `stageLabelFor(...)` — small map duplicated from `bin/forge-status.js` `PIPELINE_STAGES.steps` for human-readable stage labels in the response. Marked clearly with a "DUPLICATED — keep in sync" comment and a "extract to mcp/lib/ if a third consumer arrives" note.
- Returns structured fields the skill needs: `runId`, `pipelineType`, `mode`, `feature`, `status`, `currentStep`, `stageLabel`, `gateState`, `worktreePath`, `branchName`.

### User-facing (`skills/resume/SKILL.md`)
- Frontmatter mirrors `approve` / `discard` / `status` (`name`, `description`, `allowed-tools: "Read Write"`).
- Step 1 routes between two paths based on argument presence.
- Step 2 (no-arg path) calls `forge_list_runs`, filters to `running`/`gate-pending`/`created`, sorts by `updatedAt` desc, prints `<runId>  <pipelineType>  <status>  <feature>  · updated <relative time>` per row + footer. Empty-list path prints the prescribed fallback message.
- Step 3 (specific-run path) calls `forge_resume_run`, surfaces backend errors verbatim with `[forge:resume] ` prefix, and on success renders the six-section output block (header / identity / status / optional worktree / blank line / next step) with status-specific wording for `gate-pending+gate1`, `gate-pending+gate2`, `running`, and `created`.
- Trailing wording-rules section forbids "background", "another session", "auto-resume", "scheduling".

### Docs
- `docs/FORGE-REFERENCE.md` — added `/forge:resume` row to "Status & data skills" table, added explanatory paragraph naming the non-promise, added `forge_resume_run` row to the "Run registry" MCP tool table.
- `docs/CHANGELOG.md` — added a `### Run resume (/forge:resume)` subsection at the top of the existing `[2026-04-13]` block.

## Core contract (preserve in any future change)

- **Resumable statuses:** `running`, `gate-pending`, `created`. Terminal statuses (`completed`, `failed`, `discarded`) refuse cleanly.
- **Effects:** overwrite `.pipeline/run-active.json` only. Run.json itself is untouched.
- **Non-promises:** no autonomous progress; no skill invocation; no worktree recreation; no cross-session coordination (last-writer-wins on `run-active.json`).
- **Refusal cases:** unknown runId · terminal status · wrong project (`run.projectRoot` mismatch) · bound worktree missing on disk · IO failure writing run-active.json.
- **Surface:** skill (`skills/resume/SKILL.md`), not a slash command. The repo migrated commands → skills in `fbc54f3` to fix runtime shadowing; resume follows the established pattern alongside `approve`/`discard`/`status`/`dashboard`.

## Why skill, not command

`commands/forge/` was deliberately emptied in `fbc54f3 Migrate commands/forge/ to skills/ — fix runtime skill shadowing`. Every FORGE pipeline operation is now a skill: skills get both natural-language intent dispatch and `/forge:<name>` invocation from the same artifact. Reintroducing a slash command for resume would re-trigger the shadowing bug that `fbc54f3` fixed, for zero gain over the skill surface.

## Verification done

Six-case logic verification driver (run from `.git/forge-resume-verify.mjs`, gitignored, deleted after use) exercised the resume flow against scratch projects in `os.tmpdir()`. All passed:
1. **Success — gate-pending:** writes correct `run-active.json`.
2. **Refusal — terminal/completed:** exact contracted message.
3. **Refusal — unknown runId:** exact contracted message.
4. **Refusal — missing worktree:** message includes the absolute path.
5. **RunId normalization:** accepts both `r-abc` and `abc` forms.
6. **Refusal — wrong project:** registry-lookup short-circuits with "not found in registry" (the explicit `projectRoot` mismatch path is defense-in-depth for manually-copied run.json files).

`node --check mcp/server.js` passed. Skill frontmatter parity confirmed against `approve`/`discard`/`status`. Forbidden-wording grep against `skills/resume/SKILL.md` returned zero leaks.

## Deferred follow-ups (intentional)

- **Stage-label map extraction:** `PIPELINE_STAGE_LABELS` is duplicated between `bin/forge-status.js` (CommonJS) and `mcp/server.js` (ESM). Extract to `mcp/lib/pipeline-stages.js` only when a third consumer arrives. Drift risk noted in the inline comment at both sites.
- **Intent-dispatch overlap with `/forge:status`:** the resume skill description includes "list resumable runs" as a trigger; if natural-language users start mis-routing between resume and status, refine descriptions. Not a problem yet.
- **Run vs session terminology sweep:** `docs/FORGE-OVERVIEW.md`, `docs/FORGE-REFERENCE.md`, statusline labels, and several skill bodies still mix "run" and "session". Decision-only architecture pass already chose "run" as the canonical user-facing identity term. Sweep is a future slice.
- **Cross-Claude-session coordination:** two Claude sessions in the same project will race on `run-active.json`. Acceptable until forced by real concurrent use; revisit only when needed.
- **Worktree resurrection on resume:** intentionally refused rather than silently re-created via `git worktree add forge/<runId>` — avoids resurrecting outdated branch state. Forces explicit human recovery decision.

## Adjacent decisions made this session (carry-over context)

- **PostCompact closure (`b8205e2`):** all four PostCompact stdout shapes were proven echoed/rejected; `hooks/ctx-post-compact.js` is now a deliberate silent no-op. Runtime truth in `docs/gotchas/GENERAL.md` § "PostCompact hook — do not use for context reinjection". For future silent reinjection, use PreCompact-marker + UserPromptSubmit-inject.
- **Plugin-era catch-up baseline (`597c1df`):** large interleaved backlog was committed as one honest catch-up rather than fictionalized themed splits. Granular commits resume from this baseline forward. `.gitignore` extended to suppress `.pipeline/runs/`, `docs/context/*-status.json`, `docs/context/reviewer-output/`, `docs/context/triage-excerpts/`, `.claude/settings.local.json`, `mcp_stderr.txt`, `.forge-hook-canary.txt`.
- **Session/run model decision:** a "run" is a durable, identity-bearing, pause-able logical unit — not a guaranteed background worker. Multi-run semantics are real today (registry, gate-pending, runId targeting, worktree isolation, statusline fanout) but autonomous progress is not. Future dashboard scope = registry inspection + actions, NOT process supervision.

---

# Handoff: Visibility, Targeting, Windows Compatibility

## Overview

Major UX and correctness pass: removed forked-context invisibility from pipeline skills, made gate targeting deterministic via runId, filtered active-run contamination, fixed Windows worktree creation end-to-end, made the FORGE banner reliable, and rolled out the project-level statusline with a Windows-safe launch wrapper.

## What changed (this session)

### 1. Pipeline skill visibility (skills/*/SKILL.md)
Removed `context: fork` from 6 core pipeline skills (plan, implement, apply, debug, refactor, chat). Pipelines now run in the main conversation — user sees brainstormer questions, planner reasoning, reviewer verdicts, and tool calls live. Maintenance skills (ideate, refresh, refresh-docs) keep `context: fork`.

### 2. Canonical feature preservation (mcp/server.js + hooks/gate-sync.js)
- `forge_update_run` overrides `gateState.feature` with stored `run.feature` (skill cannot drift it via paraphrasing)
- `gate-sync.js` uses canonical `run.feature` for both pending and approved gateState updates, repairs gate-pending.json on disk if it drifted
- `forge_create_run` apply path now binds worktree by `gateState.gate === "gate2" && status === "approved"` from the implement run — no fuzzy feature matching

### 3. Gate runId targeting (mcp/server.js + gate-sync.js + 4 skills + approve/discard)
- `gate-pending.json` schema extended with `runId` field — single deterministic current-gate pointer
- `forge_set_gate` accepts optional `runId` parameter, persists it, uses it for run registry sync
- `gate-sync.js` prefers `runId` from gate file (O(1) lookup), falls back to feature-match for legacy gate files, repairs missing runId on write
- approve/discard skills read `runId` first; pipeline skills (plan/implement/debug/refactor) include `runId` in Write instructions
- Backward compatible: old gate files without `runId` still work via feature-match fallback

### 4. Active-run contamination filter (hooks/subagent-start.js + subagent-stop.js)
- Allowlist derived from `${CLAUDE_PLUGIN_ROOT}/agents/*.md` filenames
- Only FORGE agent types are recorded in `run-active.json.agents` — built-in subagents (general-purpose, Explore, claude-code-guide) silently skipped
- Tolerates `forge:` namespace prefix (e.g., `forge:integrity-checker` matches `integrity-checker`)
- Symmetric filter on stop hook prevents spurious "no matching entry" warnings

### 5. createWorktree.js Windows compatibility (packages/forge-core/src/runs/createWorktree.js)
Three layered fixes:
- Replaced `git rev-parse --git-dir` PATH-dependent check with filesystem `.git` existence check
- Added `getGitExecutable()` resolver: tries `git` on PATH, falls back to `Program Files\Git\` and `LOCALAPPDATA\Programs\Git\` candidates (covers per-user installs)
- Switched from `execSync` (shell-based, hits cmd.exe quoting bugs) to `execFileSync` (direct process spawn, no shell parsing)
- Result: forge_create_worktree works in real MCP runtime even when git/node aren't on PATH

### 6. FORGE banner (forge-banner.txt + hooks)
- SessionStart hook writes `.pipeline/forge-banner-pending` flag
- First PostToolUse hook (`ctx-post-tool.js`) reads flag → injects banner via `additionalContext` → deletes flag → exits
- Banner appears once on first response of fresh session and after `/clear`; never spams
- PostCompact path removed — was producing ugly raw JSON in compaction logs

### 7. Statusline rollout (multi-step)
- `bin/forge-status.js` rewritten from `mode` field reading to registry-driven derivation
- Pipeline stage mapping: each pipelineType maps `currentStep` → stage with truthful progress bar
- Gate display distinguishes gate1 ("plan approval needed") vs gate2 ("implementation approval needed")
- Multi-pipeline fanout with `+N more` overflow
- Idle state: `⚒  FORGE · <project> · idle`
- Project-level registration via `/forge:init` (writes `.claude/forge-status.cmd` wrapper using `process.execPath` for Node, embeds absolute paths)
- Wrapper avoids both bare-`node`-on-PATH dependency AND cmd.exe double-quoted-token parsing bug
- Stdin timeout (500ms) prevents hangs if Claude Code keeps stdin open

### 8. Statusline registry-authority fix (bin/forge-status.js)
- Latest fix: fallback to `run-active.json` no longer trusts the pointer over the registry
- If `run-active.json` names a run, looks it up in registry first
- If registry shows terminal status (completed/discarded/failed), drops to idle (was incorrectly showing "planning" on completed runs)
- Only synthesizes when registry doesn't know the run at all (true fallback)

### 9. Apply skill multi-step worktree wiring (skills/apply/SKILL.md)
- STEP 2b: resolve worktree from implement run, persist `worktreePath` to `run-active.json`
- STEP 3 worktree targeting block: prepend "Working directory: <wtPath>" instructions for implementer/documenter
- STEP 8: mandatory worktree commit before merge (uses `git -C <wtPath>`)
- STEP 9: `node bin/forge-worktree.js merge <runId>` for merge-back + cleanup

### 10. Worktree path isolation enforcement (hooks/workflow-guard.js)
- During worktree-backed apply, source writes outside the resolved worktree path are blocked with exit 2
- Reads `worktreePath` from `run-active.json`; falls back to no-block when absent

### 11. Worktree merge safety (bin/forge-worktree.js)
- `merge()` now detects merge conflicts, runs `git merge --abort`, preserves worktree/branch, exits non-zero with actionable JSON error
- Cleanup (worktree remove + branch delete) only runs after confirmed successful merge
- Pre-merge `git status --porcelain` check — commits real changes only, no `--allow-empty`

## What is NOT covered

- Multiple concurrent FORGE pipelines in the same session — `run-active.json` is overwritten by each new `forge_create_run` (separate cross-session coordination concern)
- handoff.md `# Handoff:` header still uses model-paraphrased name (display-only, acceptable)
- ideate/refresh/refresh-docs maintenance skills still use `context: fork` (intentional — they produce single reports)
- OpenAI Codex API integration (still blocked on user's billing)
- Wave progress in statusline (run-active.json doesn't track waves yet)
