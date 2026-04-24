# Slice Brief: Extract Documenter Lifecycle — Slice 1 (Wave 1)

## Slice goal
Bump maxTurns on 7 agents, strip lifecycle steps from documenter, and create the standalone post-apply-lifecycle script — leaving only the skill wiring (task 5) for wave 2.

## Why this slice, why this order
The 7 maxTurns bumps are independent one-line frontmatter edits with no coupling risk and land first. Stripping documenter before creating the replacement script ensures the script is written knowing exactly what was removed. The new script is the most complex addition and must come last so its logic is grounded in the freshly-stripped documenter steps.

## In scope
- `agents/coder-scout.md` — bump `maxTurns` from 5 to 8 (task 3)
- `agents/gotcha-checker.md` — bump `maxTurns` from 10 to 15 (task 4)
- `agents/reviewer-boundary.md` — bump `maxTurns` from 10 to 15 (task 6)
- `agents/reviewer-logic.md` — bump `maxTurns` from 10 to 15 (task 7)
- `agents/reviewer-performance.md` — bump `maxTurns` from 10 to 15 (task 8)
- `agents/reviewer-safety.md` — bump `maxTurns` from 10 to 15 (task 9)
- `agents/reviewer-style.md` — bump `maxTurns` from 10 to 15 (task 10)
- `agents/documenter.md` — remove Steps 6, 7, 8, 8b; leave Steps 0–5d and 8c intact (task 2)
- `scripts/post-apply-lifecycle.mjs` — create new ESM script: accepts feature name as `process.argv[2]`, runs 5 I/O jobs (reviewer archival, sidecar deletion, TESTING.md archival, CHANGELOG.md archival, RESEARCH file deletion), individual try/catch per job, logs to stderr, always exits 0 (task 1)

## Out of scope — do not touch
- `skills/apply/SKILL.md` — task 5 (wave 2); wiring the invocation depends on this slice's script being stable and reviewed first

## Dependency order
1. Bump maxTurns in all 7 agent files (tasks 3, 4, 6–10) — self-contained frontmatter edits; no ordering between them; complete all 7 before touching documenter
2. Strip Steps 6, 7, 8, 8b from `agents/documenter.md` (task 2) — read the full file first to confirm exact step headings; Step 8c must remain intact
3. Create `scripts/post-apply-lifecycle.mjs` (task 1) — implement last; the stripped documenter steps are the authoritative spec for what the script must replicate; follow `scripts/reviewer-dispatch.mjs` ESM pattern

## Success criteria
- All 7 agent files have the correct `maxTurns` value stated per task
- `agents/documenter.md` contains no reference to Step 6, Step 7, Step 8, or Step 8b; Steps 0–5d and 8c are present and unmodified
- `scripts/post-apply-lifecycle.mjs` exists, is valid ESM, accepts feature name via `process.argv[2]`, wraps each of the 5 jobs in its own try/catch, writes all progress to stderr, and always calls `process.exit(0)`

## Risks and mitigations
- Step 8 vs Step 8b vs Step 8c: read `agents/documenter.md` fully before editing — stripping "Step 8" with a broad match would silently delete 8c (which must be preserved); target each heading precisely
