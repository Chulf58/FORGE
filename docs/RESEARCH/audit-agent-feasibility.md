# Audit Agent Feasibility Research
_Completed: 2026-03-22_

## Question
Would a dedicated audit agent that reads agent .md files and surfaces redundant reads, overlapping responsibilities, and token-heavy patterns be useful?

## Verdict
**Don't build a persistent agent.** Most redundancy is intentional by design. The genuine optimization candidates are small enough to fix manually. A recurring agent would generate ~80% false positives (intentional design flagged as waste).

---

## What was found

### Genuine redundancy (optimization candidates)
- **Stack context duplicated 7×** — 1.5 KB "Tech stack / FORGE defaults" block copied verbatim into Planner, Coder, Researcher, Debug, Refactor, Gotcha-Checker, Implementer. Consolidating to a shared reference would save ~40 KB/run.
- **IPC quadruple pattern documented 4×** — Planner, Coder, Gotcha-Checker, Reviewer all define the same 4-file rule in full. Could be a shared reference.
- **Three-layer boundary rules repeated 4×** — Planner, Debug, Gotcha-Checker, Reviewer.

### Intentional redundancy (do not optimize)
- **GENERAL.md read by 11 agents** — Correct. Each agent must read project-specific overrides independently; no caching possible.
- **Reviewer trio (Reviewer, Reviewer-Safety, Reviewer-Logic)** — Run in parallel, must be self-contained. Duplication is protective.
- **IPC checks in Gotcha-Checker AND Reviewer** — Catches different failure modes at different gates (plan-stage vs implement-stage). Redundancy is protective.

### Does tool-call-auditor already cover this?
No. tool-call-auditor is purely post-run (reads `docs/audit-log.jsonl` for runtime anti-patterns). A static analysis agent would read .md definitions, not execution logs — different scope entirely.

---

## Why not a persistent agent

1. **High false-positive rate** — Would flag intentional design as waste. User would need to document 10+ exceptions per report to suppress noise.
2. **Low actionable signal** — ~20% genuine optimization, ~80% intentional design. Not worth recurring invocation.
3. **Maintenance burden** — Heuristics decay as new agents/gates are added.
4. **agent-optimizer already exists** — Handles the runtime optimization path (tool-call-auditor → agent-optimizer → prompt fixes).

---

## When to audit manually instead

- On adding a new agent — spot 3+ instances of identical sections vs. existing agents → consolidate
- When GENERAL.md grows past 500 lines — consider splitting
- After a gate redesign — verify agent-to-gate dependency flow
- Quarterly stack update — verify defaults still match reality

---

## Potential one-off improvement

If the stack context duplication (~40 KB/run savings) becomes worth addressing, the fix would be: consolidate the "Tech stack defaults" block into `docs/gotchas/GENERAL.md` (already read by all 11 agents) and remove the duplicated blocks from individual agent files. That's a targeted edit to 7 files, not a new agent.
