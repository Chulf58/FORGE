Show FORGE project status. Read from disk, present text summary.

Read: `.pipeline/project.json`, `.pipeline/board.json`, `.pipeline/gate-pending.json`, `docs/PLAN.md`, `docs/context/handoff.md`

Output:
```
FORGE Status
Project: <name> (<stack>) | Mode: <pipelineMode>
Board: <N> open TODOs, <M> planned items
Plan: <active feature or "none"> | Handoff: <exists/not found>
Gate: <pending gate1/gate2 or "none">
```
