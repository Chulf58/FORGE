---
name: dashboard
description: "Show all active FORGE sessions with styled cards. Use when: user asks 'what's running', wants session overview, or checks parallel pipeline progress."
allowed-tools: "Read Glob"
---

Show all active FORGE sessions with styled cards.

Prefer MCP tools: `forge_get_active_run` for run state, `forge_check_gate` for gate status. For worktree sessions, fall back to reading `.pipeline/run-active.json` and `.pipeline/gate-pending.json` from each `.worktrees/` directory directly (MCP tools only read the main project).

## Output format:

For each active session, render a card:

```
+-- * Session: <name> ---------- <elapsed> --+
|  Status: <mode> (<detail>)                 |
|  ########.. <progress description>         |
+--------------------------------------------+
```

For sessions needing attention (gate pending), highlight:

```
+-- ! Session: <name> ---------- <elapsed> --+
|  Status: GATE -- awaiting approval         |
|  <plan/impl summary>                       |
|  > approve | x discard                     |
+--------------------------------------------+
```

End with a summary line:
```
FORGE: <N> sessions | <M> need attention | ~$<cost> spent
```

If no sessions are active, print: "No active sessions. Run /forge:plan to begin."
