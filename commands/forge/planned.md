Show FORGE planned items.

Read `.pipeline/board.json`. Parse the `planned` array.

## Output format

```
Planned Items (<N> total)
─────────────────────────
[planned]     <title> — module: <moduleName>
[in-progress] <title> — module: <moduleName>
[done]        <title> — module: <moduleName>
```

Show status, title (truncated to 80 chars), and module assignment. Sort: in-progress first, then planned, then done.

$ARGUMENTS
