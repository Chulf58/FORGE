Show FORGE health signals for this project.

Read `.pipeline/board.json` and check for a `healthSignals` field. Also scan `docs/context/signal-log.jsonl` for recent [health] signals (last 20 entries).

## Output format

If signals exist:
```
Health Signals
──────────────
[high] file.ts | coupling | touched by handoff — verify side effects
[med]  store.ts | complexity | 12 IPC channels in one file
[low]  config.ts | documentation | missing JSDoc on public API
```

If no signals: "No health signals recorded."

Group by severity (high first). Show file, aspect, and note for each.
