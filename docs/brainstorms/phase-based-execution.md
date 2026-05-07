---
title: Phase-Based Execution
date: 2026-05-02
scope: large
---

## What

The user wants the FORGE implement pipeline to support multi-phase feature execution. The planner writes phases as `## Phase N` headings inside `docs/PLAN.md`. The implement skill auto-detects those headings and, if present, loops the coder+reviewer pipeline once per phase — committing to the worktree branch after each phase passes — before presenting a single Gate #2 for the user to approve the full set. If no phases are present, the skill runs once as it does today.

## Why

Large features currently land as a single coder run covering every task at once. This produces oversize handoff files, deeper revision loops, and reviewers covering too much surface at once. Splitting work into phases lets the coder focus on a bounded slice, lets reviewers catch problems early before the next phase starts, and produces a legible per-phase commit history in the worktree branch — without requiring the user to manually approve intermediate gates for every phase.

## Requirements

1. **Planner phase output format.** When the planner decides a feature needs phasing (more than ~8 tasks or natural logical seams), it writes phases as `## Phase N — <short label>` headings inside the `### Feature: <name>` section. Each phase contains a subset of the numbered task list. Tasks inside a phase use the same `- [ ] N.` format and AC-ID sequence as today. Phase headings are optional — a plan with no `## Phase` headings runs as a single phase (current behaviour unchanged).

   Canonical PLAN.md shape with phases:
   ```markdown
   ### Feature: <Feature Name>

   Summary: <one sentence>

   ## Phase 1 — Foundation
   - [ ] 1. <task> (`path/to/file.ts`)
     Intent: ...
     Verify: AC-1: ...
   - [ ] 2. <task> (`path/to/file.ts`)
     Intent: ...
     Verify: AC-2: ...

   ## Phase 2 — Integration
   - [ ] 3. <task> (`path/to/file.ts`)
     Intent: ...
     Verify: AC-3: ...
   ```

   AC-IDs remain a flat global sequence across all phases in the feature (no reset per phase).

2. **Planner permission to write phases.** The planner agent (`agents/planner.md`) gains an explicit permission to write `## Phase N — <label>` headings when a feature has natural phase seams. The existing "split large features into phases" guidance in the planning rules becomes a concrete structural instruction with the above format.

3. **Implement skill phase detection.** At Step 2 (read plan), after reading `docs/PLAN.md`, the worker parses the active feature section for `## Phase N` headings. If one or more are found, it enters phase-loop mode. If none are found, it proceeds identically to the current single-pass flow.

4. **Phase-loop execution.** For each phase in order (Phase 1, Phase 2, ...):
   a. Scope all agents (implementation-architect, coder-scout, coder, completeness-checker, reviewers) to only the tasks under the current phase heading — not the full feature task list.
   b. Run the full coder pipeline for that phase (Steps 2b through 5c in the current skill).
   c. After reviewers pass (or max revisions reached), run a per-phase git commit in the worktree: `git -C <worktreePath> add -A && git -C <worktreePath> commit -m "feat: <feature> — Phase N"`. This commit is on the worktree branch, not main.
   d. If a phase's reviewer verdict is BLOCK, write `gate-pending.json` with `"blocked": true` and stop the loop at that phase — do not proceed to subsequent phases. Present the blocker at Gate #2 with a note indicating which phase was blocked.
   e. After all phases complete, proceed to Gate #2.

5. **Single Gate #2.** Gate #2 fires once after all phases have run (or if a phase was blocked and the loop stopped). The gate presentation lists each phase, its reviewer verdict (APPROVED / REVISE-unresolved / BLOCKED), and whether its commit was written. The user approves or discards the entire worktree branch as a unit.

6. **Single worktree, single runId.** All phases execute in the same worktree (`.worktrees/<runId>/`) on the same branch (`forge/<runId>`). No new worktrees or runIds are created per phase. The final merge after Gate #2 approval merges all phase commits as a single branch merge.

7. **Run schema — `phases` field.** Add a `phases` field to the `Run` Zod schema in `packages/forge-core/src/runs/schemas.js`. Shape:

   ```js
   phases: z.array(z.object({
     index: z.number().int(),          // 1-based phase number
     label: z.string(),                // label from "## Phase N — <label>" or "Phase N"
     status: z.enum(['pending', 'running', 'completed', 'skipped', 'blocked']).default('pending'),
     committedAt: z.string().nullable().default(null),  // ISO timestamp of per-phase commit
     reviewerVerdict: z.enum(['approved', 'revise', 'blocked']).nullable().default(null),
   })).nullable().default(null)
   ```

   `phases` is `null` on all runs that have no phase structure (current behaviour unchanged). The skill populates it via `forge_update_run` as each phase completes.

8. **`forge_update_run` phases support.** The `forge_update_run` MCP tool already supports partial merges on the `stages` map. Extend the same merge behaviour to `phases`: if `phases` is passed, the server merges the provided array entries by `index` into the stored array — it does not replace the whole array. If `phases` is `null` on the stored run, it initialises from the provided value.

9. **No changes to Gate #1.** The plan gate (Gate #1) already shows the user `docs/PLAN.md`. Phase headings are visible to the user at Gate #1 as part of the normal plan review. No special handling is needed.

10. **No observer/TUI changes for MVP.** The observer reads `gateState` and run `status` for its display. Phase progress is stored in `run.phases[]` but the observer does not need to surface individual phase cards for MVP. This is deferred to a follow-up.

11. **Backward compatibility.** The `phases` field is nullable with a `null` default. Existing run.json files parse without error. Non-phased runs (the majority) are unaffected.

## Approach

The implement skill's worker-side steps are the primary change surface. After reading the plan, the worker extracts `## Phase N` headings and their task ranges using a simple regex/line-scan (no new scripts needed — the skill does this in-context). If phases are found, it wraps the existing pipeline loop (Steps 2b–5c) in a `for phase of phases` loop, passing the phase's task subset as context to each agent. After each phase's reviewer pass, the skill issues a Bash git commit scoped to the worktree. The run schema gains the `phases` field, which the skill writes incrementally via `forge_update_run`. The planner agent gains explicit format instructions for writing `## Phase N — <label>` headings. No new MCP tools are needed — `forge_update_run` is extended to merge `phases` array entries by index.

## Affected areas

- `agents/planner.md` — add phase-heading format rules and permission to write `## Phase N — <label>`
- `skills/implement/SKILL.md` — Step 2 (plan parse), Step 3 (coder pipeline loop), Step 6 (Gate #2 presentation) — phase detection, loop logic, per-phase commit, and gate summary
- `packages/forge-core/src/runs/schemas.js` — add `phases` field to `Run` schema
- `packages/forge-core/src/runs/updateRun.js` — extend merge logic to handle `phases` array merging by `index`
- `mcp/server.js` or `mcp/lib/` — expose `phases` merge behaviour through `forge_update_run` tool handler

## Open questions

- Should the per-phase commit message include the phase label (e.g. `feat: phase-based-execution — Phase 1 — Foundation`) or just the number? The label is more human-readable in `git log`; the number is unambiguous for tooling. Recommendation: include both — `feat: <feature> — Phase 1: Foundation`.
- Should a REVISE-unresolved (max iterations reached) on a phase stop the loop, or should subsequent phases proceed anyway? Current answers say only BLOCK stops the loop — REVISE-unresolved continues to the next phase and is surfaced at Gate #2. Confirm this is correct before implementing.
- The `forge_update_run` phases merge-by-index behaviour needs a decision on handling index collisions (a phase re-submitted with the same index). Recommendation: last-write wins (same as the `stages` map overwrite-by-key behaviour).
