# GENERAL — FORGE Plugin (Node.js + Markdown + JSON)

## Agent frontmatter — required fields

Every `agents/*.md` file needs YAML frontmatter: `name` (string), `description` (quoted if colons/special chars), `model` (valid ID: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`), `tools` (array).

---

## Hook scripts — stdin/stdout protocol

- **stdout** — JSON output (e.g., `additionalContext` for SessionStart)
- **stderr** — user-visible messages (shown in terminal)
- **exit 0** — success; **exit 2** — block tool call (PreToolUse only)
- Read stdin completely before processing. See any existing hook for the readline + timeout pattern.

---

## PostCompact hook — deliberate no-op

No supported output shape injects context silently. `hooks/ctx-post-compact.js` is a no-op. Do not add stdout/stderr to it.

---

## Hook paths — use `${CLAUDE_PLUGIN_ROOT}` in `hooks/hooks.json`. Never relative paths.

## Command naming — folder-based: `commands/forge/plan.md` → `/forge:plan`. No colons in filenames (Windows).

---

## run-active.json lifecycle contract

| Role | Owner |
|------|-------|
| Create / initialise | `forge_create_run` and `forge_resume_run` MCP tools |
| Append agent entries | `hooks/subagent-start.js` (SubagentStart) |
| Delete on terminal run | `hooks/ctx-session-start.js` |
| Clear `currentUnit` on stop | `hooks/subagent-stop.js` (SubagentStop) |

**Terminal statuses:** `completed`, `failed`, `discarded`. **Fail-open:** absent/unreadable `run.json` = non-terminal.

---

## Safety: YAML/Markdown injection

User-supplied strings interpolated into YAML frontmatter or markdown can inject structure. Strip newlines: `s.replace(/[\r\n]/g, ' ').trim()`.

---

## Safety: feature names in shell commands

Feature names are user-controlled. **Strip before shell embedding:** `"`, `\`, `` ` ``, `$`, `\n`, `\r`, control characters. Branch slugs: lowercase, `[a-z0-9-]` only. Always use `<safe-feature>` in git/gh commands.

---

## Platform differences (Windows)

- Use `path.join()` / `path.resolve()`, never string concatenation for paths
- Temp files: `os.tmpdir()`, never hardcode `/tmp/`
- Ensure `node` is on PATH for hook scripts

---

## MCP server — forge-pipeline

Entry point: `mcp/server.js` (ESM). Separate `mcp/package.json` with `"type": "module"` — do not merge with plugin root (CommonJS hooks).

- Tool naming: `forge_` prefix, `snake_case`
- **Never `console.log()`** — corrupts JSON-RPC. Use `console.error()`.
- Error handling: try/catch in every handler, return `{ content: [...], isError: true }`. Never throw.
- JSON read/write: read full file, parse, mutate in-place, write back. Preserves unknown fields.
- Project dir: `resolveProjectDir()` per invocation, never cached at module level.
- `CLAUDE_PLUGIN_ROOT` is NOT available as env var in MCP processes — use `CLAUDE_PLUGIN_DATA` or `process.cwd()`.

---

## Git integration — gitIntegration config

Opt-in via `.pipeline/project.json`: `gitIntegration: { enabled, branchPrefix, autoCommit, autoPR }`. All default false. Every git step logs `[git-integration]` prefix and continues on failure. **Forbidden:** `--force`, `--amend`, `--no-verify`, `git reset`, `git clean`, `git stash`.

---

## Known tool limitations

**Glob on worktree paths** — Glob can produce false negatives under worktree roots (`.worktrees/<runId>/`). Before assuming a file is absent, try Read on the expected path directly.

**Subagent text truncation** — Subagent text output can truncate even when underlying file writes succeed. Treat truncated coder summary text as cosmetic unless written artifacts (e.g. `docs/context/handoff.md`) are actually missing or incomplete.

---

## Mechanically enforced (hooks — do not duplicate here)

These rules are enforced by hooks with descriptive block/warning messages. Agents do not need to read about them — violations are caught and explained at runtime:

- **Gate enforcement** — `hooks/gate-enforcement.js`: blocks coder (gate1) and implementer (gate2) unless approved. Worktree-aware.
- **Git guard** — `hooks/bash-guard.js`: hard-blocks destructive git ops, soft-blocks commit/push without approval token or active run.
- **Stuck-loop detection** — `hooks/subagent-start.js`: blocks 3rd+ dispatch of same agent type per run.
- **Doc size thresholds** — `hooks/doc-size-guard.js`: warns when PLAN.md >80, CHANGELOG >200, ARCHITECTURE >800, GENERAL.md >200 lines.
- **Truncation detection** — `hooks/subagent-stop.js`: marks agents as `truncated` or `no-verdict` when expected output artifacts are missing.
