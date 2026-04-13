# GENERAL — FORGE Plugin (Node.js + Markdown + JSON)

> This project is a Claude Code plugin. It contains no Electron, Svelte, IPC, or UI code. Agents: ignore any Electron, Svelte 5, IPC, contextBridge, or renderer references in agent definitions — those are from the legacy FORGE Electron app and do not apply here.

---

## Plugin structure — know what lives where

| Type | Path | Format |
|------|------|--------|
| Agent definitions | `agents/*.md` | Markdown with YAML frontmatter |
| Slash commands | `commands/forge/*.md` | Markdown with optional YAML frontmatter |
| Hook declarations | `hooks/hooks.json` | JSON — maps hook events to scripts |
| Hook scripts | `hooks/*.js` | Node.js scripts (stdin JSON, stdout/stderr output) |
| Plugin manifest | `.claude-plugin/plugin.json` | JSON — name, version, author |
| Utility scripts | `forge-status.js`, `forge-worktree.js` | Node.js scripts (standalone) |
| Project templates | `templates/` | Directory trees copied by `/forge:init` |

---

## Agent frontmatter — required fields

Every agent file in `agents/` must have valid YAML frontmatter:

```yaml
---
name: agent-name
description: "One-line description — quote if it contains colons"
model: claude-sonnet-4-6
tools:
  - Read
  - Write
  - Glob
  - Grep
---
```

- `description` must be quoted if it contains colons, dashes, or special YAML characters
- `model` must be a valid model ID: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`
- `tools` is an array of tool names the agent is allowed to use

---

## Hook scripts — stdin/stdout protocol

Hook scripts receive a JSON payload on stdin and communicate via:
- **stdout** — JSON output (e.g., `additionalContext` for SessionStart)
- **stderr** — user-visible messages (shown in terminal)
- **exit code 0** — success (tool call proceeds)
- **exit code 2** — block the tool call (PreToolUse only)

Always read stdin completely before processing. Use a readline + timeout pattern:

```js
const rl = readline.createInterface({ input: process.stdin });
let input = '';
rl.on('line', (line) => { input += line + '\n'; });
rl.on('close', () => { main(input).catch(() => process.exit(0)); });
```

---

## PostCompact hook — do not use for context reinjection

Proven against the current Claude Code runtime (2026-04). All four output shapes were tested live:

| Output shape | Validator | UX |
|---|---|---|
| `hookSpecificOutput` JSON envelope | **Rejected** ("Hook JSON output validation failed") | n/a |
| Plain stdout text | Accepted | Echoed verbatim into `/compact` completion line |
| Top-level `{"systemMessage": "...", "suppressOutput": true}` | Accepted | Echoed verbatim — `suppressOutput` does not hide it |
| Top-level `{"additionalContext": "...", "suppressOutput": true}` | Accepted | Echoed verbatim — `suppressOutput` does not hide it |

There is **no supported PostCompact output shape that both injects context and stays out of the visible completion-line chrome**. `hooks/ctx-post-compact.js` is therefore a deliberate silent no-op (exit 0, zero stdout, zero stderr) until the protocol changes.

Do not add any `process.stdout.write` or `console.log` to this hook — anything it emits will be dumped into the user's view on every compaction.

For future silent re-injection, use a different mechanism (e.g. `PreCompact` writes a marker file, `UserPromptSubmit` injects it via `hookSpecificOutput.additionalContext` and deletes the marker — `UserPromptSubmit` is on the validator's `hookSpecificOutput` allow-list, so silent injection is viable there).

---

## Hook paths — always use absolute or ${CLAUDE_PLUGIN_ROOT}

In `hooks/hooks.json`, use `${CLAUDE_PLUGIN_ROOT}` for paths:

```json
"command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/ctx-post-tool.js\""
```

Never use relative paths like `node .claude/hooks/...` — the working directory is the user's project, not the plugin directory.

---

## Command naming — folder-based namespacing

Claude Code doesn't allow colons in filenames on Windows. Commands use folder structure instead:

```
commands/forge/plan.md    → user types /forge:plan
commands/forge/init.md    → user types /forge:init
```

---

## Pipeline state files — per-project, not in the plugin

The plugin itself has `.pipeline/` and `docs/` for tracking work on the plugin. But when the plugin runs against a target project, it reads/writes that project's `.pipeline/` and `docs/`.

Files the pipeline reads/writes in the target project:
- `.pipeline/board.json` — task board
- `.pipeline/project.json` — project config
- `.pipeline/modules.json` — module registry
- `.pipeline/run-active.json` — active run state (temporary)
- `.pipeline/gate-pending.json` — pending gate (temporary)
- `docs/PLAN.md` — active plan
- `docs/context/handoff.md` — implementation draft
- `docs/gotchas/GENERAL.md` — project-specific gotchas

---

## Signal protocol — bracket-prefix lines from agents

Agents emit signals as lines starting with `[signal-name]`. These are consumed by the orchestrator or hooks:

| Signal | Format | Purpose |
|--------|--------|---------|
| `[suggest]` | `[suggest] chip text` | Suggest next action |
| `[todo]` | `[todo] task text` | Add TODO to board |
| `[health]` | `[health] file\|aspect\|sev\|note` | Report code health issue |
| `[questions]` / `[/questions]` | multi-line block | Agent clarification questions |
| `[reviewer-verdict]` | `[reviewer-verdict] {...JSON}` | Reviewer result (APPROVED/BLOCK/REVISE) |
| `[CONTEXT-CHECKPOINT]` | literal | Context window low — checkpoint needed |

---

## Safety: YAML/Markdown injection

User-supplied strings interpolated into YAML frontmatter or markdown can inject structure. When interpolating user input into YAML, strip newlines: `s.replace(/[\r\n]/g, ' ').trim()`.

---

## Platform differences (Windows)

- Hook scripts run via `node` — ensure `node` is on PATH
- Path separators: use `path.join()` / `path.resolve()` in hook scripts, never string concatenation
- Temp files go to `os.tmpdir()` — never hardcode `/tmp/`
- Claude executable locations: `~/.local/bin/claude.exe`, `AppData/Roaming/npm/claude.cmd`

---

## File size thresholds — keep docs lean

| File | Threshold | Strategy |
|------|-----------|----------|
| `docs/PLAN.md` | 80 lines | Archive completed sections to `docs/PLAN-archive.md` |
| `docs/CHANGELOG.md` | 200 lines | Archive to `docs/archive/CHANGELOG_HISTORY.md` |
| `docs/ARCHITECTURE.md` | 800 lines | Prune stale content on review |
