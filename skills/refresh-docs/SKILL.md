---
name: refresh-docs
description: "Regenerate FORGE-OVERVIEW.md and FORGE-REFERENCE.md from source files. Use when: user wants to update the overview/reference docs, says 'refresh docs', or after a major milestone."
argument-hint: "[optional: 'reference-only' or 'overview-only' to limit scope]"
context: fork
allowed-tools: "Read Write Edit Glob Grep Bash Agent"
model: claude-sonnet-4-6
---

Regenerate FORGE's two key documents from source-of-truth files. Follow the recipe at `docs/FORGE-OVERVIEW-RECIPE.md` exactly.

## Step 0 — Read the recipe

Read `docs/FORGE-OVERVIEW-RECIPE.md` fully before doing anything else. It defines what goes in each file, which sources to read, and the generation checklist.

## Step 1 — Scope decision

Check `$ARGUMENTS`:
- `reference-only` → skip FORGE-OVERVIEW.md, only regenerate FORGE-REFERENCE.md
- `overview-only` → skip FORGE-REFERENCE.md, only update FORGE-OVERVIEW.md
- empty or anything else → update both (default)

## Step 2 — Read all source-of-truth files

Read every source file listed in the recipe's "Source files to read" table. Do not write from memory. Key sources:

| Source | What to extract |
|--------|----------------|
| `CLAUDE.md` | Pipeline types, modes, key source locations |
| `docs/gotchas/GENERAL.md` | Signal protocol, pipeline modes, conventions |
| `agents/*.md` (all) | Frontmatter: name, description, model, tools, maxTurns, effort |
| `skills/*/SKILL.md` (all) | Name, description, which agents invoked |
| `hooks/hooks.json` | Event types, matchers, script paths |
| `hooks/*.js` (all) | First 30-50 lines: what each does, blocks or advisory |
| `mcp/server.js` | All registerTool calls: name, description, inputSchema, readOnlyHint |
| `mcp/lib/*.js` | Module purposes, key functions |
| `.claude-plugin/plugin.json` | Plugin version |
| `.pipeline/modules.json` | Module inventory |
| `.pipeline/board.json` | Open items for "What's planned" |
| `docs/CHANGELOG.md` | Recent changes for Era assessment |
| `docs/DECISIONS.md` | Recent architecture decisions |
| `forge-config.default.json` | Model routing defaults |
| `docs/RESEARCH/*.md` | Competitive data for comparison tables |

**Count everything:** agents, skills, hooks, MCP tools, lib modules. You'll state these counts in the docs.

## Step 3 — Regenerate FORGE-REFERENCE.md

Follow the recipe's Part 2 exactly:

1. Read the current `docs/FORGE-REFERENCE.md` (required before overwriting)
2. Write a complete new `docs/FORGE-REFERENCE.md` with all 15 sections per the recipe
3. Verify: no stale references to Electron, Svelte, IPC, src/main/, src/renderer/, .claude/agents/

The 15 sections in order:
1. Pipeline Architecture & Modes
2. The Gate System
3. Wave Execution
4. Every Agent — Roles and Models
5. The Signal Protocol
6. How a Pipeline Run Executes (step-by-step walkthroughs, data flow diagram, self-improvement loop)
7. Hook Technical Protocol (stdin/stdout format, exit codes, worked examples)
8. Skills (User Commands)
9. Hook Inventory
10. MCP Server & Tools (with registration pattern, transport)
11. Model Routing (4-priority fallback chain, budget modes)
12. Project Configuration
13. Module Map
14. Key Files Reference
15. Documentation Structure

## Step 4 — Update FORGE-OVERVIEW.md

Follow the recipe's Part 1. Only update data-driven sections:

1. **"What's planned next"** — regenerate from board.json open items, grouped by theme
2. **Comparison tables** — update if new capabilities shipped or new research exists
3. **"What Is FORGE?"** — update counts (agents, skills, hooks, MCP tools) if they changed
4. **"Why Use FORGE"** — update if onboarding experience changed

**Do NOT:**
- Add a new Era (that requires human editorial judgment — tell the user if one seems warranted)
- Touch the Glass Wall section
- Touch existing Era narratives
- Add reference data that belongs in FORGE-REFERENCE.md

If a new Era seems warranted based on CHANGELOG entries since the last Era, tell the user: "A new Era may be warranted — [reason]. Want me to draft it?"

## Step 5 — Verify

1. Check line counts: FORGE-REFERENCE.md should be 700+ lines, FORGE-OVERVIEW.md should be 600+ lines
2. Grep both files for stale references: `Electron|Svelte|IPC|ipcMain|ipcRenderer|contextBridge|src/main/|src/renderer/|src/preload/` — only allowed in historical Era narratives in the overview
3. Report: what changed, counts verified, any issues found

## Output

After completion, report:
- Files updated (with line counts)
- Counts: agents, skills, hooks, MCP tools, lib modules
- Whether a new Era seems warranted
- Any stale references or issues found
