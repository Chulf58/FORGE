# Slice Brief: Signal protocol optimization — Slice 1 (Wave 1)

## Slice goal
Remove all `[health]` and `[module]` signal emissions from the five agent files that produce them, replacing each with the appropriate plain-text or `[todo]` alternative.

## Why this slice, why this order
Wave 1 tasks (1-5) are pure deletion/replacement in five independent agent markdown files with no dependencies on each other or on any downstream agent. Completing wave 1 first ensures wave 2 (coder-status.json expansion, parallelization) and wave 3 (consumer updates) land on a clean signal surface. No hooks, schemas, or runtime code are touched, so system behaviour is unaffected between slices.

## In scope
- `agents/architect.md` — remove all `[health]` emission instructions; replace HEALTH-mode output with plain-text observations (task 1)
- `agents/integrity-checker.md` — replace all ~23 `[health]` references with `[todo]` emissions using ideator priority format (`[todo] HIGH/MEDIUM/LOW: title — description`); convert summary line to plain-text print (task 2)
- `agents/reviewer-logic.md` — remove all `[health]` emission instructions; express dead-code observations as REVISE warnings in the reviewer verdict instead (task 3)
- `agents/reviewer-triage.md` — remove the single `[health]` emission instruction; express coupling concerns through existing triage output channels (task 4)
- `agents/planner.md` — delete Step 4 module assignment block and all `[module]` signal emission instructions (task 5)

## Out of scope — do not touch
- `agents/coder.md` — wave 2 task 6; depends on wave 1 landing stable first, and its consumers (tasks 7-8) must follow it in slice 2
- `agents/completeness-checker.md` — wave 3 task 7; depends on coder.md changes from task 6
- `agents/documenter.md` — wave 3 task 8; depends on coder.md changes from task 6
- `skills/implement/SKILL.md` — wave 2 task 9; independent of wave 1 but belongs in slice 2 to keep this slice under 5 files
- `skills/plan/SKILL.md` — wave 2 task 10; same reason
- `docs/SIGNAL-PROTOCOL.md` — wave 2 task 11; must reflect all removals as complete before updating; slice 2

## Dependency order
1. `agents/architect.md` — no dependencies; straightforward deletion
2. `agents/integrity-checker.md` — no dependencies; largest change (~23 references); use ideator priority format for `[todo]` emissions
3. `agents/reviewer-logic.md` — no dependencies; straightforward deletion with REVISE-warning redirect
4. `agents/reviewer-triage.md` — no dependencies; single `[health]` line removal
5. `agents/planner.md` — no dependencies; delete module assignment block and `[module]` emission line

## Success criteria
- `agents/architect.md` contains zero occurrences of `[health]`
- `agents/integrity-checker.md` contains zero occurrences of `[health]`; all severity-graded findings emit `[todo] HIGH/MEDIUM/LOW: ...`
- `agents/reviewer-logic.md` contains zero occurrences of `[health]`
- `agents/reviewer-triage.md` contains zero occurrences of `[health]`
- `agents/planner.md` contains zero occurrences of `[module]`

## Risks and mitigations
- integrity-checker [todo] format: use `[todo] HIGH: title — description` (ideator priority format) per research finding — not the planner's numbered list format; this matches board.json ingestion for severity-graded items
- slice 2 is required to complete this feature: tasks 6-11 (coder.md expansion, skill parallelization, SIGNAL-PROTOCOL.md update) are out of scope here and must follow in a subsequent slice-brief
