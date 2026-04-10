# Research: Context Window Monitoring

---

## Question: What exact JSON field contains context window usage in a Claude Code PostToolUse hook stdin payload?

**Finding:** The `PostToolUse` hook stdin payload does NOT include context window usage fields. The PostToolUse stdin schema is:

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/path/to/project",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { ... },
  "tool_response": { ... },
  "tool_use_id": "toolu_01ABC123..."
}
```

The `context_window.used_percentage` / `context_window.remaining_percentage` fields exist only in the **statusline** payload, not in hook payloads. This is a confirmed and open feature request — GitHub issues #34879, #34340, #33420, and #34184 all request exposing token usage to hooks, and as of March 2026 they remain unresolved.

**The only path to context usage in a hook is to read the transcript file referenced by `transcript_path`.**

The transcript JSONL file stores one JSON object per line. The last non-sidechain, non-error assistant message contains `message.usage` with these fields:
- `message.usage.input_tokens` — regular input tokens
- `message.usage.cache_read_input_tokens` — cached tokens (still consume context)
- `message.usage.cache_creation_input_tokens` — tokens written to cache

Total context used = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
Context window size = 200,000 tokens for Sonnet/Haiku; 1,000,000 for extended-context models.
Remaining percentage = `100 - Math.round((total / contextWindowSize) * 100)`.

The `used_percentage` in the statusline is calculated the same way: input tokens only (no output tokens), matching the formula above.

Skip entries where `isSidechain === true` (sub-agent calls) and `isApiErrorMessage === true`.

**Source:**
- Official docs: `https://code.claude.com/docs/en/statusline` — statusline schema with full `context_window` object
- Official docs: `https://code.claude.com/docs/en/hooks` — PostToolUse schema (no context fields)
- GitHub issue #16087 (statusline_payload_missing_context_window_data) — confirms context fields absent from hook payloads; bash workaround using `transcript_path` jq parsing
- GitHub issue #34879 — confirms feature not implemented as of March 17, 2026
- `https://codelynx.dev/posts/calculate-claude-code-context` — transcript JSONL field names and formula

**Recommendation:** The hook script must:
1. Read `transcript_path` from stdin JSON.
2. Read the JSONL file and find the last entry where `isSidechain !== true` and `isApiErrorMessage !== true` and `message.usage` exists.
3. Sum `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
4. Compute `remainingPct = 100 - Math.round((total / 200000) * 100)`.
5. Handle the case where `transcript_path` is absent or the file is empty (emit nothing, exit 0).

The hard-coded 200,000 is correct for all Sonnet and Haiku models. For future-proofing, the hook could check `model.id` from the transcript if that field is present. For now 200,000 is the safe default.

Do NOT attempt to use a `context_window_used_pct` or similar field from stdin — it does not exist in PostToolUse payloads.

---

## Question: Should hook settings go in settings.json (committed) or settings.local.json (gitignored) for new and imported projects?

**Finding:** The official Claude Code docs (`https://code.claude.com/docs/en/hooks-guide`, Configure hook location section) define the following distinction:

| File | Scope | Shareable |
|------|-------|-----------|
| `.claude/settings.json` | Single project | Yes — can be committed to the repo |
| `.claude/settings.local.json` | Single project | No — gitignored |

For FORGE's own development environment (`.claude/settings.local.json`), keeping the hook registration in `.local` is correct: FORGE's own `settings.local.json` already exists (`C:/Users/cuj/Forge/.claude/settings.local.json`) and contains `permissions.allow` entries that are user-specific. Adding the `hooks` key to `settings.local.json` for the FORGE dev project is correct per task 2 of the plan.

For **scaffolded and imported projects** (the `template/.claude/settings.json` created by task 4), `settings.json` is the correct choice because:
1. `settings.local.json` is gitignored by default and would not be committed with a new project, meaning every developer cloning the project would silently lose the hook.
2. The hook script itself (`.claude/hooks/context-monitor.js`) is project-specific and should be committed.
3. The hook registration has no sensitive data (no API keys, no personal paths) — it is safe to commit.
4. This matches the pattern used by existing examples in the official docs (all project-level hook examples use `.claude/settings.json`).

Confirmed: `template/.claude/settings.json` does not currently exist in the FORGE repo (glob returned no results). It must be created by task 4.

The `template/.claude/` directory currently contains only `agents/documenter.md` — no settings files at all.

**Source:**
- `C:/Users/cuj/Forge/.claude/settings.local.json` — confirms FORGE's own dev settings are in `.local`
- `C:/Users/cuj/Forge/template/.claude/agents/documenter.md` — confirms `template/.claude/` directory structure
- `https://code.claude.com/docs/en/hooks-guide` — hook location scope table

**Recommendation:**
- Task 2: Add `hooks` key to `.claude/settings.local.json` in the FORGE repo. Merge with the existing `permissions` key — do not overwrite it. The resulting file must preserve all existing `permissions.allow` entries.
- Task 4: Create `template/.claude/settings.json` (not `.local.json`). This file contains only the `hooks` registration — no `permissions` block (those are user-specific). This file will be committed with the template and copied to new projects.
- In both files the hook registration object is:
  ```json
  {
    "hooks": {
      "PostToolUse": [
        {
          "matcher": "*",
          "hooks": [{ "type": "command", "command": "node .claude/hooks/context-monitor.js" }]
        }
      ]
    }
  }
  ```

---

## Question: Is `node` reliably on PATH inside Claude Code hook execution on Windows, or does the hook command need an absolute path to node.exe?

**Finding:** `node` is reliably in PATH when Claude Code hooks execute on Windows. The reasoning is definitive: Claude Code itself is a Node.js application. Because Claude Code depends on Node.js at runtime, `node` is guaranteed to be installed and on the system PATH on every platform (Windows, macOS, Linux) where Claude Code runs at all. A hook command of `node .claude/hooks/context-monitor.js` will resolve correctly.

This is confirmed by:
1. `claudefa.st/blog/tools/hooks/cross-platform-hooks` (2026): "Since Claude Code requires Node.js on every platform, the node command is always available." Recommends `node .claude/hooks/formatter.mjs` as the cross-platform command format.
2. FORGE's own `src/main/index.ts` shows Claude Code is launched via `findClaude()` which resolves `claude.exe` or `claude.cmd` — the Claude Code executable itself requires Node. The hook's child process inherits the same environment where `node` is available.
3. The official hook examples in `https://code.claude.com/docs/en/hooks-guide` use `jq`, `bash`, and other commands, all requiring the tool to be available in PATH. `node` is held to the same standard.

**Windows-specific considerations that DO apply:**

1. **Claude Code runs hooks through Git Bash on Windows** (confirmed by `blog.netnerds.net/2026/02/claude-code-powershell-hooks/` and GitHub issue #18527). This means hooks are bash processes, not cmd or PowerShell. The shebang line (`#!/usr/bin/env node`) is ignored on Windows when the command is invoked directly as `node script.js` — this is fine because the `command` field specifies `node` explicitly.

2. **Path separator in the command**: `node .claude/hooks/context-monitor.js` uses a forward slash which Git Bash handles correctly. Do not use backslashes in the `command` field.

3. **Line endings in the hook script**: Since the hook script lives in `.claude/hooks/context-monitor.js` (a `.js` file, not `.sh`), line ending concerns are minimal. Node.js handles CRLF in `.js` files without issue. No `.gitattributes` change is needed for a `.js` hook.

4. **Known Windows path-with-spaces issue** (GitHub issue #16152): Hooks fail if `CLAUDE_PLUGIN_ROOT` contains spaces in the path because the variable is not quoted. This does NOT affect the context-monitor hook because it uses a relative path (`node .claude/hooks/context-monitor.js`) rather than `$CLAUDE_PLUGIN_ROOT`. The hook will run with `cwd` set to the project folder, so the relative path resolves correctly.

5. **Temp file for debounce state**: The hook script needs a temp file to persist call count and last severity between invocations (no persistent process). Use `os.tmpdir()` + a fixed filename (e.g., `context-monitor-state.json`) inside Node.js — never hardcode `C:\Windows\Temp` or `/tmp`. Use `path.join(os.tmpdir(), 'forge-context-monitor.json')` for cross-platform reliability.

**Source:**
- `https://claudefa.st/blog/tools/hooks/cross-platform-hooks`
- `https://blog.netnerds.net/2026/02/claude-code-powershell-hooks/`
- `https://github.com/anthropics/claude-code/issues/18527`
- `https://github.com/anthropics/claude-code/issues/16152`
- `C:/Users/cuj/Forge/src/main/index.ts` lines 14–31 — `findClaude()` confirms Node.js dependency chain

**Recommendation:** Use `node .claude/hooks/context-monitor.js` as the command in both `settings.local.json` and `template/.claude/settings.json`. No absolute path, no shebang, no platform detection needed. Inside the hook script use `os.tmpdir()` and `path.join()` for the debounce state file path — never hardcode OS-specific temp paths.

---

## Additional Finding: Stop event as alternative hook point

If transcript reading proves unreliable in PostToolUse (e.g., transcript file not yet flushed when hook fires), the `Stop` event (fires when Claude finishes responding) also provides `transcript_path` in its stdin payload and is guaranteed to fire after all tool use in a turn is complete. The tradeoff: `Stop` fires less frequently than `PostToolUse`, which means coarser granularity for the debounce. For a warning system, `PostToolUse` is correct — it fires after every tool call and allows early warning before the turn ends.

The `Stop` stdin payload includes `stop_hook_active` (a boolean); the hook must check for this and `exit 0` if true to prevent infinite loops.

**Recommendation:** Stay with `PostToolUse` as specified in the plan. No change needed to the plan's hook event choice.
