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
| Utility scripts | `bin/forge-status.js`, `bin/forge-worktree.js` | Node.js scripts (standalone) |
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
- `.pipeline/project.json` — project config (includes optional `testCommand` for post-apply test execution)
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
| `[task-block]` | `[task-block] taskId blockedBy:id1,id2` | Mark a task as blocked by other tasks |
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

---

## MCP server — forge-pipeline

The plugin bundles an MCP server at `mcp/server.js` (ESM) that provides structured tool access to pipeline state. It is separate from the CommonJS hook scripts at the plugin root.

**Key files:**
- `mcp/server.js` — MCP server entry point (ESM, `import` syntax)
- `mcp/package.json` — dependencies with `"type": "module"` (separate from plugin root to avoid breaking CommonJS hooks)
- `.mcp.json` — declares the server for Claude Code auto-start; uses `${CLAUDE_PLUGIN_ROOT}` for the script path
- `hooks/mcp-deps-install.js` — SessionStart hook that installs dependencies into `mcp/node_modules/` under `${CLAUDE_PLUGIN_ROOT}`

**Project directory resolution:**
- Primary: `process.cwd()` (set by Claude Code per MCP spec when spawning the server)
- Override: `CLAUDE_PROJECT_DIR` env var (optional)
- Call `resolveProjectDir()` inside each tool handler at invocation time — never cache the result at module level

**Tool naming:** All tools use the `forge_` prefix with `snake_case` (e.g. `forge_read_board`, `forge_add_todo`).

**Tool registration:** `server.registerTool(name, config, handler)` with Zod input schemas. The SDK converts Zod to JSON Schema automatically.

**Error handling:** Every handler wraps logic in try/catch. Errors return `{ content: [{ type: "text", text: "..." }], isError: true }`. Never throw from handlers — thrown exceptions become protocol-level errors invisible to the LLM.

**Never `console.log()` in the MCP server.** It writes to stdout and corrupts JSON-RPC messages. Use `console.error()` for debug output.

**JSON read/write pattern:** Always read the full file, parse, mutate in-place, write the full object back. Never reconstruct objects from known fields only — this preserves unknown/extra fields.

**Dev-only `.mcp.json` double-load warning:** When the current working directory IS the plugin repo (i.e. developing the plugin itself), `/doctor` shows a warning (`Missing environment variables: CLAUDE_PLUGIN_ROOT`) and a plugin error (`MCP server "forge-pipeline" skipped — same command/URL as already-configured`). This is cosmetic. Claude Code reads `.mcp.json` twice: once as plugin config (expands `${CLAUDE_PLUGIN_ROOT}`, starts the server correctly) and once as project config (no expansion, fails, skipped as duplicate). The MCP server works — only the `/doctor` output is noisy. This does NOT affect installed target-project use, where only the plugin read fires.

---

## Git integration — gitIntegration config

The apply pipeline supports opt-in git operations via `gitIntegration` in `.pipeline/project.json`:

```json
"gitIntegration": {
  "enabled": false,
  "branchPrefix": "forge/",
  "autoCommit": false,
  "autoPR": false
}
```

- **enabled** — master switch. All git steps skip when false (default).
- **branchPrefix** — prefix for feature branches (default: `"forge/"`). Branch name: `<prefix><sanitized-slug>`.
- **autoCommit** — commit all changes after implementer + tests. Commit message: `feat(forge): <feature name>`.
- **autoPR** — create PR via `gh pr create` after documenter. Requires `gh` CLI installed and authenticated.

**Error handling:** Every git step logs with `[git-integration]` prefix and continues on failure. Git failures never block the pipeline.

**Forbidden operations:** `--force`, `--amend`, `--no-verify`, `git reset`, `git clean`, `git stash` — never used by the apply pipeline.

**Set via MCP:** `forge_update_config` with key `"gitIntegration"` and an object value.

---

## Model routing — forge-config.json

The plugin includes an intelligent model routing layer. Key conventions:

**Config file locations:**
- Primary: `${CLAUDE_PLUGIN_DATA}/forge-config.json` — persistent across plugin updates; bootstrapped from `forge-config.default.json` on first session via SessionStart hook
- Fallback: `.pipeline/forge-config.json` in the project directory — per-project override; used when `CLAUDE_PLUGIN_DATA` is not set

**Environment variable resolution:**
- `resolvePluginDataDir()` in `mcp/lib/config-store.js` returns `process.env.CLAUDE_PLUGIN_DATA || null`
- Returns `null` when not set — callers fall back to the project `.pipeline/` directory
- **`CLAUDE_PLUGIN_ROOT` is NOT reliably available as an env var in MCP server processes** — do not use it for config file resolution (it is only expanded in `.mcp.json` args and hook commands)

**API key handling:**
- API keys are referenced by environment variable name only (`envVar` field in provider config)
- Never store plaintext API key values in `forge-config.json`
- MCP tool handlers resolve keys at call time via `process.env[provider.envVar]`
- Reject both `undefined` and empty string: `if (!apiKey) return errorResult(...)`

**Two-track routing architecture:**
- Anthropic models are routed via the `model:` field in agent frontmatter — Claude Code handles model selection natively; the router is advisory only for Anthropic
- External providers (OpenAI, etc.) use the `forge_call_external` MCP tool — not subagent model selection
- `forge_get_model_recommendation` returns a recommendation object but does not execute any call

**Usage state:**
- Lives in `.pipeline/usage.json` in the **project** directory (per-project, not global)
- Tracks `requestCount`, `tokenCount`, `lastUsed`, `quotaExhausted`, `resetAt` per provider

**Module layout:**
- `mcp/lib/config-store.js` — config read/write; exports `readForgeConfig`, `writeForgeConfig`, `resolvePluginDataDir`
- `mcp/lib/usage-store.js` — usage state read/write; exports `readUsage`, `writeUsage`, `markQuotaExhausted`, `recordUsage`
- `mcp/lib/router.js` — pure recommendation function; no I/O; exports `recommendModel`
- `mcp/lib/openai-adapter.js` — OpenAI Responses API adapter; exports `callOpenAI`
- `mcp/server.js` — tool registration only; imports from `mcp/lib/`
- Default config template bundled at plugin root as `forge-config.default.json`
