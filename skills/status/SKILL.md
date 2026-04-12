---
name: status
description: "Show FORGE project status. Use when: user asks 'what's the status', 'where are we', or wants a project overview."
allowed-tools: "Read Glob"
---

Show FORGE project status. Read from disk, present text summary.

Prefer MCP tools when available: `forge_read_project`, `forge_read_board`, `forge_check_gate`. Fall back to reading files directly if MCP unavailable. Also read: `docs/PLAN.md`, `docs/context/handoff.md`

Output:
```
FORGE Status
Project: <name> (<stack>) | Mode: <pipelineMode>
Board: <N> open TODOs (<B> blocked), <M> planned items
Plan: <active feature or "none"> | Handoff: <exists/not found>
Gate: <pending gate1/gate2 or "none">
```
