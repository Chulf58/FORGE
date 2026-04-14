---
name: forge:overview
description: "Generate a comprehensive FORGE plugin overview. Use when: user wants a full inventory of agents, skills, hooks, MCP tools, board state, and enforcement mechanisms."
allowed-tools: "Read Glob Grep Bash"
---

Generate a comprehensive FORGE plugin overview. Read every relevant file — don't summarize from memory.

## Sections to produce

### 1. Plugin Identity
Read `.claude-plugin/plugin.json`. Show name, version, description.

### 2. Agents (full inventory)
Glob `agents/*.md`. For each agent, read the frontmatter and extract: name, model, effort, maxTurns, description. Present as a table sorted by effort tier (heavy → medium → light).

### 3. Skills (full inventory)
Glob `skills/*/SKILL.md`. For each skill, read the frontmatter and extract: name, description, context (fork or main). Present as a table.

### 4. Hooks (by event type)
Read `hooks/hooks.json`. For each event type, list every hook entry with: matcher, script path, and whether it blocks (PreToolUse exit 2) or advises (PostToolUse/Stop/PostCompact additionalContext). Present as a table grouped by event type.

### 5. MCP Server
Read `mcp/server.js`. Find every `server.registerTool(` call — extract tool name, title, description, and readOnlyHint annotation. Also list lib modules from `mcp/lib/`. Present tools as a table.

### 6. Enforcement Stack
List each enforcement mechanism: what rule it enforces, which hook implements it, and whether it's a hard block (exit 2) or advisory. Distinguish laws (hookable) from guidelines (prompt-only).

### 7. Board State
Read `.pipeline/board.json` (use Bash with node for JSON parsing — file is too large for Read). Show: total open, total done, breakdown by priority, top 5 tags by count. List the high-priority open items.

### 8. Project Config
Read `.pipeline/project.json`. Show all fields.

### 9. File Tree
Use Bash to show directory structure and file counts per directory. Include line counts for key files (server.js, hooks, agents).

### 10. Known Issues & Gaps
Read `docs/context/handoff.md` known issues section. List anything flagged as broken, parked, or needing manual testing.

## Output format

Use markdown tables where possible. Group logically. Be exhaustive — this is the full inventory, not a summary.
