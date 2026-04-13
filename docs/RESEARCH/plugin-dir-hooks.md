# Research: Plugin-dir + Hook Root Variable

## Key facts
- `${CLAUDE_PLUGIN_ROOT}` fails silently in SessionStart hooks — variable is not exported at that lifecycle stage (GitHub issue #27145, closed as duplicate)
- `${CLAUDE_PLUGIN_ROOT}` does NOT expand in command markdown files — only in JSON (hooks.json, .mcp.json) and agent/skill frontmatter (GitHub issue #9354)
- `--plugin-dir` does set CLAUDE_PLUGIN_ROOT for PreToolUse/PostToolUse, but not SessionStart; workaround is to hardcode absolute path from plugin cache
- For local dev testing: either use absolute path in hooks.json, or use `${CLAUDE_PLUGIN_DATA}` (persistent symlink across versions)
- Hook commands with unexpanded `${CLAUDE_PLUGIN_ROOT}` fail with exit code 1 but do not block pipeline — failures are silent/logged only

## Findings

### Q1: Does `--plugin-dir` set CLAUDE_PLUGIN_ROOT?

**Finding:** `--plugin-dir` does expand `${CLAUDE_PLUGIN_ROOT}` in hooks.json, but ONLY for PreToolUse and PostToolUse lifecycle events. SessionStart hooks (where `mcp-deps-install.js`, `ctx-session-start.js`, `forge-banner.js` run) do NOT receive the expanded variable — it remains undefined, causing paths to become empty strings.

**Source:** [GitHub issue #27145](https://github.com/anthropics/claude-code/issues/27145) — reported Feb 24, 2026, closed as duplicate of #24529.

**Recommendation:** SessionStart hooks cannot rely on `${CLAUDE_PLUGIN_ROOT}`. Workaround: compute the absolute path at hook invocation time by reading `~/.claude/plugins/installed_plugins.json` (internal Claude Code registry), or switch to `${CLAUDE_PLUGIN_DATA}` (a persistent directory that survives version updates).

---

### Q2: How does Claude Code expand `${CLAUDE_PLUGIN_ROOT}`?

**Finding:** Variable expansion is template-based, not shell-based. It works in JSON config files (hooks.json, .mcp.json) and YAML frontmatter, but NOT in command markdown file bodies. When expansion fails, the variable leaves a blank string in its place, causing command paths to become relative/invalid.

**Source:** [GitHub issue #9354](https://github.com/anthropics/claude-code/issues/9354) — variable expansion scope documented as JSON-only.

**Recommendation:** Do not use `${CLAUDE_PLUGIN_ROOT}` in command markdown slash commands. For SessionStart hooks, use `${CLAUDE_PLUGIN_DATA}` instead (a writable directory guaranteed at plugin init time).

---

### Q3: Workaround for local dev?

**Finding:** For `--plugin-dir` local testing, replace `${CLAUDE_PLUGIN_ROOT}` with a hardcoded absolute path. For production, use `${CLAUDE_PLUGIN_DATA}` (symlink-based persistent storage). Community workaround: bootstrap a `.claude/cpr.sh` script that reads Claude's plugin registry to resolve paths dynamically.

**Source:** Community solution in issue #9354.

**Recommendation:** Use `${CLAUDE_PLUGIN_DATA}` for all hooks — it avoids version cache bugs and works at SessionStart.

---
