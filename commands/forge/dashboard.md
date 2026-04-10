Show all active FORGE sessions with styled cards.

Read `.pipeline/run-active.json` from the main project and from each directory in `.worktrees/`.
Read `.pipeline/gate-pending.json` from each location for gate status.

## Output format:

For each active session, render a card:

```
╭─ ● Session: <name> ────────── <elapsed> ─╮
│  Status: <mode> (<detail>)                │
│  ████████░░ <progress description>        │
╰───────────────────────────────────────────╯
```

For sessions needing attention (gate pending), highlight:

```
╭─ ⚡ Session: <name> ───────── <elapsed> ─╮
│  Status: GATE — awaiting approval         │
│  <plan/impl summary>                      │
│  ► approve │ ✕ discard                   │
╰───────────────────────────────────────────╯
```

End with a summary line:
```
FORGE: <N> sessions │ <M> need attention │ ~$<cost> spent
```

If no sessions are active, print: "No active sessions. Run /forge:start to begin."
