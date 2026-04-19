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

## Gate enforcement (mechanical, PreToolUse)

`hooks/gate-enforcement.js` blocks Agent-tool dispatches for `coder` and `implementer` unless the corresponding gate is approved on disk:

- **`coder`** requires `gate1` approved before dispatch.
- **`implementer`** requires `gate2` approved before dispatch.
- All other subagent types pass through unconditionally.
- `pipelineMode: TRIVIAL` or `SPRINT` bypasses gate checks (these modes have no reviewer gates by design) — a stderr note is logged.
- **To satisfy the hook:** write `.pipeline/gate-pending.json` with `{ "gate": "gate1"|"gate2", "status": "approved", "feature": "..." }` — use `/forge:approve` or the `forge_set_gate` MCP tool.
- Missing gate file, wrong gate stage, or non-approved status all produce an exit-2 deny with a descriptive block message.
- This hook enforces the *existence* of an approval record, not the discipline of presenting-and-waiting — that remains a behavioral constraint enforced by memory and agent prompts.

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

## run-active.json lifecycle contract

`.pipeline/run-active.json` is a temporary pointer file tracking the in-progress pipeline run.

| Role | Owner |
|------|-------|
| Create / initialise | `forge_create_run` and `forge_resume_run` MCP tools |
| Append agent entries | `hooks/subagent-start.js` (SubagentStart event) |
| Delete on terminal run | `hooks/ctx-session-start.js` → `emitStaleUnitNoticeIfAny` |
| Clear `currentUnit` on agent stop | `hooks/subagent-stop.js` (SubagentStop event) |

**Terminal statuses:** `completed`, `failed`, `discarded`. Any run whose `run.json` carries one of these statuses is terminal.

**Fail-open rule:** if `run.json` is absent, unreadable, or unparseable, both hooks treat the run as non-terminal and proceed normally.

**Why delete, not null-write:** writing `{ currentUnit: null }` back to disk preserves the `runId` identity field, allowing `subagent-start.js` to read and re-append to a finished run on the next agent dispatch. Deletion is the cleanest teardown — `subagent-start.js` already exits silently when the file is absent (lines 74-81).

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
| `[solution-hit]` | `[solution-hit] docs/solutions/<file>.md — <one-line summary>` | Emitted by `debug` and `researcher` when a relevant past solution is found in `docs/solutions/`; signals that a known fix pattern was applied |
| `[promote-gotcha]` | `[promote-gotcha] docs/solutions/<file>.md — <reason>` | Written into a solution file or research doc by any agent when a solution is stable enough to warrant promotion to `docs/gotchas/GENERAL.md`; consumed by `compound-refresh` to surface candidates for manual review |
| `[CONTEXT-CHECKPOINT]` | literal | Context window low — checkpoint needed |

---

## Safety: YAML/Markdown injection

User-supplied strings interpolated into YAML frontmatter or markdown can inject structure. When interpolating user input into YAML, strip newlines: `s.replace(/[\r\n]/g, ' ').trim()`.

---

## Safety: feature names in shell commands

Feature names (from `$ARGUMENTS` or plan headings) are user-controlled and must be sanitized before embedding in any shell command — particularly `git commit -m`, `gh pr create --title`, and branch name derivation.

**Strip these characters before embedding in a quoted shell argument:** `"`, `\`, `` ` ``, `$`, `\n`, `\r`, and other control characters.

The branch-slug sanitization in `skills/apply/SKILL.md` (lowercase, `[a-z0-9-]` only) is the right pattern for branch names. For commit messages and PR titles, use the broader strip above to preserve human-readable text while removing injection vectors. Always use `<safe-feature>` (the sanitized form) in git and gh commands, never the raw `$ARGUMENTS` string.

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

The plugin uses a vendor-agnostic capability-cost router. Key conventions:

**Routing principle:**
- Default scope = ALL enabled providers. `allowedVendors` is an explicit force-override (e.g. supervisor → OpenAI), not a scope default. The router never assumes Anthropic unless Anthropic is the only enabled provider or `allowedVendors` says so.
- Router selects the most-minimal model satisfying ALL `requiredCapabilities` across the scope — ordered by (1) fewest total capabilities, (2) cheapest cost tier, (3) alphabetical id. A task requiring `[analysis]` must not land on a model that also carries reasoning + agentic just because they share a cost tier; over-capable models are picked only when no narrower match is available.
- Execution path follows the returned `providerId`: `anthropic` → `Agent` subagent (tools work natively); any other provider → `forge_call_external` (skill injects context, captures output).

**Capability taxonomy:**
- Config capabilities are domain-level only: `reasoning`, `code`, `analysis`, `fast`, `agentic`, `long-context`. These describe what the model can do, not how it is invoked.
- Execution mechanics (live tool access vs injected context) are NOT routing capabilities. They are a skill-layer concern determined by which adapter handles the call, not by a flag in the config.
- Agents that need live tool access today run as Anthropic subagents because that is the currently wired adapter path with working tools. Agents that work on injected context (skill assembles the prompt, captures the output) can route to the cheapest capable provider across all enabled vendors — this is how the supervisor already works.

**Model `pricing` field:**
- Each model in the catalog carries `pricing: { input, output, cached }` with numbers in USD per 1M tokens.
- `input` = base price per 1M prompt tokens.
- `output` = base price per 1M completion tokens.
- `cached` = price per 1M cached-input-read tokens. Cache-write is typically ~1.25x input for Anthropic and varies for other vendors; it is not currently tracked as a separate field.
- For free-tier Gemini models, the `pricing` values reflect the paid-tier rate. Effective cost is $0 until daily quota is exhausted. `costTier: "free"` is the current-plan indicator; `pricing` is the real per-token rate that would apply under paid usage.
- These numbers are reference rates; vendor price sheets are authoritative. Keep them roughly current but do not treat small drift as a bug.

**Managing the catalog — `forge_add_model` and `forge_update_model`:**

Two MCP tools let you (or Claude acting on your behalf) curate `config.models` without hand-editing JSON. Both write through `readForgeConfig` / `writeForgeConfig`, so the routing cache is invalidated automatically and the next `forge_get_model_recommendation` sees the change immediately.

| Tool | Required fields | Optional fields |
|---|---|---|
| `forge_add_model` | `id`, `providerId`, `capabilities[]`, `costTier`, `pricing{input,output,cached}` | `contextWindow`, `reasoningTier`, `notes` |
| `forge_update_model` | `id` (must exist) | any of: `providerId`, `capabilities`, `costTier`, `pricing`, `contextWindow`, `reasoningTier`, `notes` — only touched fields are revalidated and replaced; the model id itself cannot be changed |

Validation is strict at the MCP boundary. Rejections:
- capability not in allowlist: `reasoning`, `code`, `analysis`, `fast`, `agentic`, `long-context` (extending requires a code change — intentional friction to prevent silent routing drift from typos like `reasonng`)
- `costTier` not in `free | low | medium | high`
- `reasoningTier` (optional, metadata only — not consulted by the router) not in `haiku | sonnet | opus`
- `pricing` missing any of the three fields, or any field non-numeric / negative / Infinity
- `contextWindow` not a positive integer
- `providerId` not referenced in `config.providers`
- `forge_add_model`: duplicate `id` (use `forge_update_model` to modify)
- `forge_update_model`: unknown `id` (use `forge_add_model` to create)

Typical operator flow via natural language:

> "I got a Perplexity API key. Add `sonar-large`, reasoning + analysis, input $1 / output $3 / cached $0.10, medium tier, 128k context."

Claude invokes:
```
forge_add_model(
  id="sonar-large", providerId="perplexity",
  capabilities=["reasoning", "analysis"], costTier="medium",
  pricing={input: 1.0, output: 3.0, cached: 0.10},
  contextWindow=128000
)
```

Or to bump an existing model's pricing:

> "Update `gemini-2.5-flash` pricing to input $0.50 / output $3.00 / cached $0.10."

```
forge_update_model(
  id="gemini-2.5-flash",
  pricing={input: 0.50, output: 3.00, cached: 0.10}
)
```

Deletion is not yet exposed as an MCP tool. To remove a model, hand-edit `config.models` for now.

**Skill orchestration routing pattern:**
1. Call `forge_get_model_recommendation(agentName)`
2. If `source === "error"`: surface reason, stop
3. If `providerId === "anthropic"`: `Agent(subagent_type=agent, model=modelId)`
4. If other provider: assemble injected prompt (see context injection map below), call `forge_call_external(providerId, modelId, prompt, maxTokens=8192)`, apply any file writes from the output yourself
5. If MCP unavailable: fall back to agent's frontmatter `model:` field

**Context injection map — what to inject per agent for non-Anthropic routing:**

| Agent | System prompt | Inject these files | Output handling |
|---|---|---|---|
| `researcher-triage` | `agents/researcher-triage.md` body | `docs/PLAN.md`, `docs/gotchas/GENERAL.md` | Parse `[brief-for: N]` blocks, dispatch researchers |
| `implementer-triage` | `agents/implementer-triage.md` body | `docs/context/handoff.md`, `docs/PLAN.md`, `docs/gotchas/GENERAL.md` | Parse `[task-brief-for:]` blocks, dispatch implementers |
| `completeness-checker` | `agents/completeness-checker.md` body | `docs/context/handoff.md`, `docs/PLAN.md` | Read verdict from output |
| `regression-risk` | `agents/regression-risk.md` body | `.pipeline/modules.json`, `docs/context/handoff.md` | Read risk output |
| `gotcha-checker` | `agents/gotcha-checker.md` body | `docs/PLAN.md`, `docs/gotchas/GENERAL.md` | Read findings from output |
| `integrity-checker` | `agents/integrity-checker.md` body | `.pipeline/project.json`, `.pipeline/modules.json`, `docs/PLAN.md` | Read findings |
| `tool-call-auditor` | `agents/tool-call-auditor.md` body | Tool log content passed in prompt | Read audit output |
| `reviewer-safety` | `agents/reviewer-safety.md` body | `docs/context/triage-excerpts/reviewer-safety.md`, `docs/gotchas/GENERAL.md` | Parse `[reviewer-verdict]` JSON |
| `reviewer-boundary` | `agents/reviewer-boundary.md` body | `docs/context/triage-excerpts/reviewer-boundary.md`, `docs/gotchas/GENERAL.md` | Parse `[reviewer-verdict]` JSON |
| `reviewer-logic` | `agents/reviewer-logic.md` body | `docs/context/triage-excerpts/reviewer-logic.md`, `docs/gotchas/GENERAL.md` | Parse `[reviewer-verdict]` JSON |
| `reviewer-style` | `agents/reviewer-style.md` body | `docs/context/triage-excerpts/reviewer-style.md`, `docs/gotchas/GENERAL.md` | Parse `[reviewer-verdict]` JSON |
| `reviewer-performance` | `agents/reviewer-performance.md` body | `docs/context/triage-excerpts/reviewer-performance.md`, `docs/gotchas/GENERAL.md` | Parse `[reviewer-verdict]` JSON |

Prompt structure for injected agents:
```
<system prompt from agents/<agent>.md — everything after closing --->\n\n
[CONTEXT]\n
<file 1 path>\n<file 1 content>\n\n
<file 2 path>\n<file 2 content>\n\n
[TASK]\n
<any additional task-specific instruction>
```

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
