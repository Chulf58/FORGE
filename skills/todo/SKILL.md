---
name: forge:todo
description: "Manage FORGE TODO board. Use when: user wants to see TODOs, add a TODO, or check the backlog."
argument-hint: "[optional: new todo text]"
allowed-tools: "Read Write"
---

Manage FORGE TODO board. Prefer MCP tools: `forge_read_board` to list, `forge_add_todo` to add, `forge_update_task` to update. Fall back to reading `.pipeline/board.json` directly if MCP unavailable.

No arguments: list open TODOs sorted by priority.
With arguments: add as new TODO (medium priority, not done).

$ARGUMENTS
