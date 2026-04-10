# FORGE Plugin Migration — Impact Analysis

## Date: 2026-04-09

## Summary

Converting FORGE from an Electron app to a Claude Code plugin is technically viable with no blocking issues. The core pipeline orchestration, agent system, and knowledge layer all transfer directly. The main losses are visual UI features (reactive sidebar, gates, dashboards) which can move to an optional companion app later.

---

## Question-by-Question Analysis

### Q1: Development workflow change
Plugin `.md` files are re-read from disk on each invocation. No hot-reload needed — edit the file, run the command, changes are live. Development becomes simpler: no Electron rebuild cycles, no main/renderer/preload split, no IPC boilerplate.

**Verdict: Simpler, not harder.**

### Q2: Existing project migration
Projects have `.pipeline/`, `docs/`, `CLAUDE.md`. A plugin reads these identically — they're just files. Only change: strip routing logic from `CLAUDE.md` (keep project brief only). The plugin's slash commands replace the routing.

**Verdict: One-time CLAUDE.md cleanup per project.**

### Q3: Settings without a UI
Config already lives in `.pipeline/project.json`. Slash commands handle changes: `/forge:config mode standard`, `/forge:config tester off`. Settings change rarely — a UI isn't needed for this.

**Verdict: Slash commands are sufficient.**

### Q4: Text-based gates (preventing accidental approval)
The agent asks "Apply these changes? Type YES to confirm." Requiring a specific word (not just Enter) maintains deliberate friction. Could also support `/forge:approve` and `/forge:discard` as explicit commands.

**Verdict: Solvable with explicit confirmation words.**

### Q5: Distribution
Git clone into `.claude/commands/forge/` is the simplest approach. The Compound Engineering Plugin uses this model. Later: npm package or install script for one-command setup.

**Verdict: Git clone for now, package later.**

### Q6: Board management (TODO/PLANNED)
Every mutation becomes explicit file I/O: read board.json → modify → write. No reactive auto-save, no race conditions from `$effect` timing. More reliable than the Svelte store approach.

**Verdict: Explicit file writes are more reliable.**

### Q7: Token cost
Electron FORGE injects ALL agents via `--agents` flag (serialized in command line). Plugin agents in `.claude/agents/` are loaded from disk only when invoked. Plugin approach is slightly cheaper.

**Verdict: Plugin is slightly cheaper.**

### Q8: Scaffolding-rethink
The scaffolding-rethink task wanted "FORGE owns runtime logic, injects at runtime." A plugin IS the runtime logic — it lives in `.claude/` and Claude Code loads it. Projects hold only project-specific data. The problem is solved by the plugin model itself.

**Verdict: Mostly solved by migration.**

### Q9: Subagent spawning
Claude Code's Agent tool works from any context — slash commands, custom agents, conversation. `/forge:plan` can invoke the brainstormer as a subagent. No change from current architecture.

**Verdict: No change needed.**

### Q10: What stays Electron-only
Optional companion app for visual-only features:
- Token usage dashboards with charts
- Visual diff viewer (beyond terminal inline)
- Project portfolio view
- Board kanban view (drag-and-drop)

These are read-only dashboards, not core pipeline. Can come later or never.

**Verdict: Companion app is optional.**

---

## Migration Work Estimate

### Phase 1 — Core plugin (must have)
1. Create `/forge:chat` — the One Chat orchestrator as a slash command
2. Create `/forge:plan`, `/forge:implement`, `/forge:apply` — pipeline triggers
3. Create `/forge:config` — settings management via slash command
4. Create `/forge:status` — show project state (board, health, context)
5. Port board management (addTodo, promoteTodoToPlanned, markDone) into file-write helpers
6. Port signal processing (gate detection, chip emission) into command output
7. Copy all agent `.md` files into plugin structure
8. Create install script

### Phase 2 — Feature parity
9. Port the brainstormer Q&A flow
10. Port knowledge compounding (docs/solutions/)
11. Port module classification (Haiku call)
12. Port TODO enrichment (Haiku call)
13. Port signal-log and audit-log management

### Phase 3 — Optional companion app
14. Token usage dashboard (read from token-log.jsonl)
15. Board visual view (read from board.json)
16. Health signals panel (read from health signals)

---

## Risks

1. **Claude Code API stability** — slash command and agent APIs may change across CLI versions. Plugin must handle graceful degradation.
2. **Platform lock-in** — plugin only works with Claude Code. If the user switches to Cursor/Copilot, the plugin doesn't transfer (though agents `.md` files do).
3. **LLM calls from plugins** — the enrich-todo and classify-module features spawn Claude CLI for Haiku calls. A plugin would need to do the same (spawn `claude` as subprocess) or find an alternative.
4. **No persistent state** — Electron had in-memory stores that survived across runs within a session. A plugin starts fresh each invocation. State must be read from disk every time.

---

## UI Strategy

**Launch (Option 5): No custom UI.** Use Claude Code's native agent cards for pipeline progress. Parallel sessions = multiple terminal windows. `/forge:status` command reads state from disk for text-based overview.

**Follow-up (Option 4): Lightweight web dashboard.** Tiny Node server (~100 lines) serving a single HTML page. File-watches `.pipeline/` for changes, WebSocket pushes updates to browser. Shows session cards, board, health signals. Read-only viewer — all control stays in the CLI. Optional — everything works without it.

**Design principle: UI is a viewer, not a controller.** All control happens through CLI commands. The dashboard only shows what's happening. This prevents the Electron problem where UI tried to be both interface and viewer.

## Plugin File Structure

```
plugins/forge/
├── .claude-plugin/plugin.json
├── commands/                    # Slash commands (user-facing)
│   ├── forge:chat.md            # One Chat orchestrator
│   ├── forge:plan.md            # Plan feature pipeline
│   ├── forge:implement.md       # Implement feature pipeline
│   ├── forge:apply.md           # Apply pipeline
│   ├── forge:debug.md           # Debug pipeline
│   ├── forge:refactor.md        # Refactor pipeline
│   ├── forge:status.md          # Show project state
│   ├── forge:config.md          # Edit settings
│   ├── forge:todo.md            # Manage TODOs
│   ├── forge:planned.md         # Manage planned items
│   ├── forge:health.md          # Show health signals
│   ├── forge:approve.md         # Approve pending gate
│   ├── forge:discard.md         # Discard pending gate
│   └── forge:init.md            # Initialize new project
├── agents/                      # All existing agents (direct copy)
├── hooks/hooks.json             # Pre/PostToolUse guards
├── settings.json                # Plugin permissions
└── references/                  # Output templates, mode definitions
```

## Recommendation

Proceed with the plugin migration. Build Phase 1 as a parallel effort — don't delete the Electron app yet. Test the plugin against real projects, compare the experience, then decide whether to fully commit or keep both.

The knowledge compounding, brainstormer, and all agent improvements we've shipped this session transfer directly to the plugin with zero changes — they're all file-based.
