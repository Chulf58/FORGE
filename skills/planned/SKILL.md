---
name: forge:planned
description: "Show FORGE planned items. Use when: user asks about planned work, upcoming tasks, or the sprint backlog."
allowed-tools: "Read"
---

Show FORGE planned items.

Prefer MCP tool `forge_read_board` for board data. Note: forge_read_board reads todos only — for planned items, fall back to reading `.pipeline/board.json` directly and parsing the `planned` array.

## Output format

```
Planned Items (<N> total)
-------------------------
[planned]     <title> -- module: <moduleName>
[in-progress] <title> -- module: <moduleName>
[done]        <title> -- module: <moduleName>
```

Show status, title (truncated to 80 chars), and module assignment. Sort: in-progress first, then planned, then done.

$ARGUMENTS
