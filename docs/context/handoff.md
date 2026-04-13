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
