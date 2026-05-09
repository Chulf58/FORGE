## Active Plan

### Feature: Per-run context isolation

Summary: Move reviewer-output, researcher-status, and verdict files from shared project-root paths to per-run worktree-scoped paths so concurrent runs cannot collide.

#### Discovery — current read/write sites

**`docs/context/reviewer-output/`** (producers)
- `agents/reviewer-safety.md:49–53` — resolves dir from `[reviewer-output-dir: <path>]` prompt signal or falls back to `docs/context/reviewer-output/`
- `agents/reviewer-boundary.md:67–69` — same pattern
- `agents/reviewer-logic.md:64–66` — same pattern
- `agents/reviewer-performance.md:45–47` — same pattern
- `agents/_archived/reviewer-style.md:100` — hardcoded `docs/context/reviewer-output/reviewer-style.md`

**`docs/context/reviewer-output/`** (consumers / cleanup)
- `skills/implement/SKILL.md:172` — clears dir between phases via `find ... -delete || del ...`
- `skills/implement/SKILL.md:240,248,249,252` — aggregates verdicts; writes `reviewer-style.md`
- `skills/refactor/SKILL.md:120,128,129,132` — same pattern
- `skills/debug/SKILL.md:126,127,130` — same pattern
- `skills/plan/SKILL.md:130` — clears stale files before plan-stage reviewer dispatch
- `scripts/post-apply-lifecycle.mjs:26–86` — archives to `.pipeline/review-archive/<ts>/` then deletes originals
- `.pipeline/agent-roles.json:3–7,24` — reviewer agents and documenter are allowed `docs/context/reviewer-output/**`

**`docs/context/researcher-status.json`** (producer)
- `agents/researcher.md:26,35,128` — researcher writes this file

**`docs/context/researcher-status.json`** (consumers)
- `agents/coder.md:98` — coder reads it to detect BLOCKED state; stops if BLOCKED
- `hooks/subagent-stop.js:273` — truncation detection reads expected artifact at `docs/context/researcher-status.json` relative to `baseDir` (already uses `data.worktreePath || projectDir`)
- `scripts/post-apply-lifecycle.mjs:96` — sidecar cleanup list

**Verdict body persistence** — no current persistence beyond the reviewer-output file. The `subagent-stop.js` hook records verdict letter (APPROVED/BLOCK/REVISE) in `run-active.json` via `entry.outcome` but does not store the full markdown body.

#### Target layout

All per-run context artifacts move under the worktree `.pipeline/context/` directory:

```
<worktreePath>/
  .pipeline/
    context/
      reviewer-output/          ← replaces docs/context/reviewer-output/
        reviewer-safety.md
        reviewer-boundary.md
        ...
      researcher-status.json    ← replaces docs/context/researcher-status.json
      verdicts/                 ← NEW: full markdown body per reviewer per phase
        <runId>-<reviewer>-<phase>.md
```

The existing `docs/context/` tree is unchanged for all other sidecars (`handoff.md`, `scout.json`, `coder-status.json`, `git-diff.txt`, `slice-brief.md`, `criteria.json`, `checkpoint.md`). Those are already scoped to the worktree (`<worktreePath>/docs/context/`) and do not need to move.

**Why `.pipeline/context/` not `docs/context/`:** reviewer-output and researcher-status are pipeline-state artifacts, not doc artifacts. `.pipeline/` is the convention for pipeline state in this project (confirmed: `run-active.json`, `gate-pending.json`, `lean-gate.json` all live under `.pipeline/`). Placing them under `.pipeline/context/` makes the isolation obvious and consistent.

#### Acceptance criteria

- Two parallel plan runs each writing reviewer-output files produce no collision: run A's `.pipeline/context/reviewer-output/reviewer-safety.md` and run B's `.pipeline/context/reviewer-output/reviewer-safety.md` are independent files in separate worktrees.
- `researcher-status.json` from run A is not visible to run B's coder or subagent-stop hook.
- Verdict bodies persist under `.pipeline/context/verdicts/<runId>-<reviewer>-<phase>.md` and survive the run for post-hoc inspection.
- The plan-stage cleanup (`find ... -delete`) targets the per-run path, eliminating the shared-dir race.
- `post-apply-lifecycle.mjs` archives from and clears `.pipeline/context/reviewer-output/` (not `docs/context/reviewer-output/`).
- `agent-roles.json` allows reviewers and documenter to write to `.pipeline/context/reviewer-output/**`.
- `subagent-stop.js` artifact-detection for `researcher` resolves to the new path.
- No backward-compat shim needed: `docs/context/reviewer-output/` directory can be absent; all callers use the new path.

---

- [ ] 1. Add `resolveContextPaths(worktreePath)` helper (`mcp/lib/context-paths.js`) (wave: 1)
  Intent: Centralise the per-run context path formulas so no caller duplicates `path.join` logic for the new layout.
  Verify: AC-1: Module exports `reviewerOutputDir`, `researcherStatusPath`, and `verdictPath(reviewer, phase)` all resolving under `<worktreePath>/.pipeline/context/`; importable from both ESM and CommonJS callers via dual-mode export or explicit `require`.

- [ ] 2. Update `agent-roles.json` allowed paths for reviewer agents and documenter (`.pipeline/agent-roles.json`) (wave: 1)
  Intent: The PreToolUse hook enforces write-target patterns; the new paths must be in the manifest or reviewers will be blocked at runtime.
  Verify: AC-2: `reviewer-boundary`, `reviewer-safety`, `reviewer-logic`, `reviewer-style`, `reviewer-performance` and `documenter` each list `.pipeline/context/reviewer-output/**` (and optionally `.pipeline/context/verdicts/**`); old `docs/context/reviewer-output/**` entries are removed.

- [ ] 3. Update reviewer agents to write to per-run path (`agents/reviewer-safety.md`, `agents/reviewer-boundary.md`, `agents/reviewer-logic.md`, `agents/reviewer-performance.md`) (wave: 2)
  Depends: 1, 2
  Intent: Each reviewer must write its verdict file into the per-run `.pipeline/context/reviewer-output/` directory so concurrent runs cannot overwrite each other's verdicts.
  Verify: AC-3: All four agents resolve their output dir from `[reviewer-output-dir: <path>]` prompt signal with no fallback to `docs/context/reviewer-output/`; the fallback line is removed or updated to the new default.

- [ ] 4. Update implement, refactor, debug skills to inject `[reviewer-output-dir]` signal and use new paths (`skills/implement/SKILL.md`, `skills/refactor/SKILL.md`, `skills/debug/SKILL.md`) (wave: 2)
  Depends: 1
  Intent: Skills must pass the per-run output dir to reviewers via prompt signal and read verdicts from the same location, replacing every hard-coded `<worktreePath>/docs/context/reviewer-output/` reference.
  Verify: AC-4: Each skill prepends `[reviewer-output-dir: <worktreePath>/.pipeline/context/reviewer-output/]` to reviewer prompts; all verdict-aggregation and REVISE/BLOCK logic reads from that path; the inter-phase clear also targets that path.

- [ ] 5. Update plan skill to use per-run reviewer-output path (`skills/plan/SKILL.md`) (wave: 2)
  Depends: 1
  Intent: Plan-stage reviewer dispatch clears stale files and reads verdicts from the per-run path, removing the shared-dir race that caused silent Write failures.
  Verify: AC-5: Plan skill Step 5 clears `<worktreePath>/.pipeline/context/reviewer-output/` (not `docs/context/reviewer-output/`); the `find ... -delete` command targets the new path.

- [ ] 6. Update researcher agent to write `researcher-status.json` to per-run path (`agents/researcher.md`) (wave: 2)
  Depends: 1
  Intent: Researcher status must be per-run so concurrent researcher invocations do not overwrite each other.
  Verify: AC-6: Researcher writes `researcher-status.json` to `<worktreePath>/.pipeline/context/researcher-status.json`; the path is resolved from a prompt-injected variable or from the helper, not hardcoded to `docs/context/`.

- [ ] 7. Update coder agent to read `researcher-status.json` from per-run path (`agents/coder.md`) (wave: 2)
  Depends: 1
  Intent: Coder's BLOCKED guard must read from the same per-run path the researcher writes to, or the guard is silently skipped.
  Verify: AC-7: Coder resolves `researcher-status.json` from `<worktreePath>/.pipeline/context/researcher-status.json`; BLOCKED guard still fires correctly.

- [ ] 8. Update `subagent-stop.js` artifact-detection map for `researcher` (`hooks/subagent-stop.js`) (wave: 2)
  Depends: 1
  Intent: Truncation detection for the researcher agent must resolve to the same path the researcher writes to, or it always reports truncation (file not found).
  Verify: AC-8: `EXPECTED_ARTIFACTS['researcher']` resolves to `.pipeline/context/researcher-status.json` under `data.worktreePath || projectDir`; test harness `hooks/subagent-stop-verdict-test.js` is updated to match.

- [ ] 9. Add verdict body persistence step in skills (`skills/implement/SKILL.md`, `skills/refactor/SKILL.md`, `skills/debug/SKILL.md`) (wave: 3)
  Depends: 4
  Intent: Full reviewer markdown must survive the run under a stable per-run key so failed runs can be inspected without re-running.
  Verify: AC-9: After collecting reviewer verdicts, each skill copies each verdict file to `<worktreePath>/.pipeline/context/verdicts/<runId>-<reviewer>-<phase>.md` (where phase is `"implement"` / `"debug"` / `"refactor"` and a per-phase index if applicable); copied files persist after the reviewer-output dir is cleared between phases.

- [ ] 10. Update `post-apply-lifecycle.mjs` to archive and clear from new path (`scripts/post-apply-lifecycle.mjs`) (wave: 2)
  Depends: 1
  Intent: The apply lifecycle must clean the new per-run location; archiving from the old `docs/context/reviewer-output/` path would archive nothing (dir is now empty).
  Verify: AC-10: `archiveReviewerOutput()` reads from `<projectDir>/.pipeline/context/reviewer-output/`; `deleteSidecars()` entry for `researcher-status.json` resolves to `.pipeline/context/researcher-status.json`; no references to `docs/context/reviewer-output/` remain in this file.

- [ ] 11. Update `agent-roles.json` researcher entry to allow `.pipeline/context/` writes (`.pipeline/agent-roles.json`) (wave: 1)
  Intent: The researcher is currently allowed to write only `docs/RESEARCH/**`; it also needs write access to its status file under `.pipeline/context/`.
  Verify: AC-11: `researcher` entry in `agent-roles.json` includes `.pipeline/context/researcher-status.json` in `allowedPaths` alongside the existing `docs/RESEARCH/**` entry.

### Research needed

- **Plan-skill path injection mechanism**: The plan skill (Step 5) runs `find ... -delete` against a hardcoded path. The worktreePath is available inside the worker but it is unclear whether the plan skill currently has `worktreePath` in scope at Step 5 (before Gate #1). Confirm: does `skills/plan/SKILL.md` have access to `<worktreePath>` at the reviewer dispatch step, or does it need to be inferred from CWD?
- **`mcp/lib/context-paths.js` module format**: `mcp/lib/worker-paths.js` is already ESM (imported via `import` in `mcp/forge-worker.mjs`); hooks are CommonJS (`require`). The new helper must be importable from both. Confirm whether a `.cjs` dual export or a simple CommonJS module (no `import`/`export`) is the right pattern for shared lib files in this repo — check `mcp/lib/worker-paths.js` module syntax.
- **Verdict body persistence — phase label**: In phased implement runs, the phase index is available in the skill; in single-pass runs there is no phase. Confirm the naming convention for single-pass verdicts (e.g., `<runId>-reviewer-safety-1.md` vs `<runId>-reviewer-safety-main.md`).

### Approach summary
- Decision: Extend the existing `<worktreePath>/.pipeline/` convention — all per-run context moves to `.pipeline/context/` inside the worktree; reviewers already accept a `[reviewer-output-dir]` prompt signal, so no new protocol is needed.
- Trade-off: `docs/context/reviewer-output/` at the project root becomes unused; no backward shim since this is a clean worktree-scoped system (old shared path was the bug).
- Uncertainty: Dual-module format for `context-paths.js` helper needs verification against existing `mcp/lib/` conventions before the coder chooses the export style.

### Resolution of plan-stage reviewer-boundary BLOCK

The plan-stage reviewer-boundary review (in `<worktreePath>/docs/context/reviewer-output/reviewer-boundary.md`) flagged 3 BLOCK-level + 6 REVISE-level concerns. Conductor decisions follow, verified against current code this session — implementer should treat these as authoritative AC supplements:

**BLOCK 1 — AC-1 module format for `mcp/lib/context-paths.js`**: ESM-only export, NOT dual-export. Verified: `mcp/lib/worker-paths.js:1` reads `import { join } from 'node:path';` — existing helpers in `mcp/lib/` are ESM. New helper follows the same pattern. CJS callers (hooks, scripts) construct the paths inline using `path.join(worktreePath, '.pipeline', 'context', 'reviewer-output')` etc — duplication is ~3 lines per hook, acceptable. If duplication grows painful later, refactor to `.cjs` dual-export. Helper exports: `reviewerOutputDir(worktreePath)`, `researcherStatusPath(worktreePath)`, `verdictPath(worktreePath, reviewer, phase)` — all returning absolute paths.

**BLOCK 2 — AC-5 plan skill timing — REJECTED AS FALSE POSITIVE**: Reviewer claimed plan skill Step 5 runs in conductor session before worker is dispatched. Verified incorrect: `skills/plan/SKILL.md:114` reads `## STEP 2 — Run planner pipeline (worker)`. Conductor only does Step 1 (classification + `forge_create_run` with `spawnWorker: true`); Steps 2-6 (including Step 5 reviewer dispatch) run inside the worker, which has resolved `worktreePath` via Step 1b's `forge_create_worktree` call. No timing constraint exists. Task 5's edit goes ahead as written.

**BLOCK 3 — AC-9 verdict persistence signal mechanism**: Option (b) — skill constructs verdict paths independently. The skill (running in worker) already has: `runId` (from worker-task), `worktreePath` (from `forge_get_run`), the list of reviewers it dispatched, and the current phase (from `skills/implement/SKILL.md:116` phase-detection logic). After collecting verdicts, each skill (`implement`/`refactor`/`debug`) copies `<worktreePath>/.pipeline/context/reviewer-output/<reviewer>.md` to `<worktreePath>/.pipeline/context/verdicts/<runId>-<reviewer>-<phase>.md`. No new prompt signal needed. No reviewer-agent changes beyond the path update in Task 3.

**Phase value for AC-9**: `implement` / `refactor` / `debug` for non-phased runs; `phase-<index>` (e.g. `phase-1`, `phase-2`) when a phased plan is detected. Skills already track which phase is running.

**REVISE-level decisions** (verified against current code):

- **AC-3** (reviewer fallback): KEEP existing fallback to `docs/context/reviewer-output/` in reviewer agent prompts. Verified at `agents/reviewer-safety.md:49-51` (and equivalents). Backward-compat for any caller that doesn't inject `[reviewer-output-dir]` signal. Safe default; doesn't conflict with the new path being primary.
- **AC-4** (skills' worktreePath source): skills run in worker context (per BLOCK 2 clarification); they obtain `worktreePath` from `forge_get_run` already called at Step 1b. No new mechanism.
- **AC-6** (researcher path injection): researcher receives standard `Your working directory for this run is: <worktreePath>` prompt injection per the existing pattern at `skills/implement/SKILL.md:179-184`. Researcher constructs the path as `<injected-cwd>/.pipeline/context/researcher-status.json`.
- **AC-7** (coder path resolution): same as AC-6 — coder uses standard `<worktreePath>` injection, hard-codes the relative path. No new prompt signal.
- **AC-8** (`subagent-stop.js` payload contract): VERIFIED already correct — `hooks/subagent-stop.js:218,279` use `data.worktreePath || projectDir` fallback. Only the `EXPECTED_ARTIFACTS['researcher']` value at line 268+ needs updating to the new relative path. No payload contract changes.
- **AC-10** (`post-apply-lifecycle.mjs` verdict cleanup): `.pipeline/context/verdicts/` is PRESERVED, not deleted. Verdict bodies are audit trail; minimal disk cost. Update Task 10 Verify: `archiveReviewerOutput()` reads from per-run path; `deleteSidecars()` does NOT include the verdicts directory.
- **AC-11** (researcher allowedPaths): `agent-roles.json` researcher entry includes BOTH `.pipeline/context/researcher-status.json` AND existing `docs/RESEARCH/**` (researcher writes both — research files go to `docs/RESEARCH/`, status file goes to per-run path). The plan's existing wording ("alongside the existing `docs/RESEARCH/**` entry") is correct.

These resolutions supersede any conflicting text in the original task ACs. The implementer should reference this section when there's ambiguity.
