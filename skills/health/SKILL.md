---
name: forge:health
description: "Show FORGE health signals for this project. Use when: user asks about code health, warnings, or quality issues."
allowed-tools: "Read Glob Grep"
---

Show FORGE health signals for this project.

Prefer MCP tool `forge_read_board` to check for health signals in board data. Fall back to reading `.pipeline/board.json` directly if MCP unavailable. Also check `docs/context/` for any recent [health] signals.

## Output format

If signals exist:
```
Health Signals
--------------
[high] file.ts | coupling | touched by handoff -- verify side effects
[med]  store.ts | complexity | 12 handlers in one file
[low]  config.ts | documentation | missing JSDoc on public API
```

If no signals: "No health signals recorded."

Group by severity (high first). Show file, aspect, and note for each.
