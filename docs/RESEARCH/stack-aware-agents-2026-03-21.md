# Research: Stack-Aware Agents / Remove Per-Project Agent Copies
**Date:** 2026-03-21

## Summary

The `--agents` JSON flag is the recommended path. It injects FORGE's full agent set into each project run at spawn time, eliminating per-project file copies entirely. Stack context is injected via `--append-system-prompt` carrying the project's `docs/gotchas/SKILLS.md` content.

---

## Q1: Do any FORGE agents self-reference their own `.claude/agents/` path?

**No blocking self-references found.**

- `integrity-checker.md` line 80: `Glob '.claude/agents/*.md'` — globs the *target project's* directory for check-5 (custom agent shadowing detection). If no agents are copied to the project, the glob returns zero results → no shadowing signals emitted. Correct and benign.
- `tester.md` line 43: `.claude/agents/**` appears in an exempt-paths list used to classify handoff changes as "doc/config only". Static string, not a file-access operation.

**No agent reads another agent's `.md` file by path. Safe to remove per-project copies.**

---

## Q2: Do any FORGE agents reference project-relative paths assuming CWD = project root?

**Category A — FORGE-specific example paths in instructional text (harmless):**
`planner.md`, `coder.md`, `gotcha-checker.md`, `implementer.md`, `reviewer.md`, `reviewer-safety.md`, `tool-call-auditor.md`, `architect.md` contain paths like `src/main/index.ts`, `src/renderer/src/...`, `src/preload/index.ts` as concrete IPC examples. For non-FORGE projects, grepping these paths finds nothing — benign, not broken.

**Category B — Pipeline doc paths (relative, safe with CWD = project root):**
All agents read `docs/PLAN.md`, `docs/RESEARCH/`, `docs/context/handoff.md`, `docs/gotchas/GENERAL.md`, `.pipeline/board.json`, etc. These resolve correctly when CWD = project root (confirmed: `spawn` sets `cwd: projectFolder` at `src/main/index.ts` line 286).

**No path changes needed in agent prompts.**

---

## Q3: How does scaffold-project currently copy agents?

Both handlers in `src/main/index.ts`:

**`scaffold-project` (line 947):**
- Source: `join(app.getAppPath(), '.claude', 'agents')` — FORGE's live agent directory
- Destination: `join(targetFolder, '.claude', 'agents')`
- Method: synchronous `copyFileSync` per file, filtered by `SCAFFOLD_AGENT_NAMES` set (20 names, lines 43–50)

**`import-project` (line 746):**
- Same pattern, async `fsPromises.copyFile`
- Same `SCAFFOLD_AGENT_NAMES` filter

**To remove copies:** delete the agent copy loop from both handlers. `SCAFFOLD_AGENT_NAMES` can be retained for reference or removed. No other copied files depend on agents being present.

---

## Q4: How does the run invocation work — where is CWD set?

`run-claude` handler at `src/main/index.ts` line 255. Spawn at line 285:
```ts
child = spawn(claudeCmd, args, {
  cwd: isChat ? undefined : projectFolder,
  shell: process.platform === 'win32',
})
```

Current args (lines 277–282): `--resume`/`--continue`, `--output-format stream-json`, `--verbose`, permission flags. **No `--add-dir` or `--agents` flag currently passed.** Prompt via stdin.

**Key flags available:**
- `--agents '<json>'` — injects agent definitions inline without `.md` files on disk. Format: `{"agent-name": {"description": "...", "prompt": "...", "tools": [...], "model": "..."}}`
- `--append-system-prompt '<text>'` — appends text to system prompt per-run
- `--add-dir` — grants file-read access to extra dirs but does **NOT** add a second `.claude/agents/` lookup path. Not viable for agent discovery.

---

## Q5: What does the project's CLAUDE.md currently contain after scaffold?

Template at `templates/code/CLAUDE.md` — 295 lines of pipeline orchestration rules. Key points:
- Defines pipeline routing, Gate system, reviewer protocol, revision loops
- **Does NOT reference FORGE-specific source paths** — stack-agnostic
- Delegates stack context to `docs/gotchas/GENERAL.md` and `docs/gotchas/SKILLS.md` (agents already instructed to read these)
- **No changes needed to CLAUDE.md.**

---

## Q6: How is the project stack stored?

`.pipeline/project.json` schema:
```json
{ "techStacks": ["string"], "techStackLabels": ["string"] }
```

`techStacks` = canonical stack identifiers (e.g. `"code"`, `"power-automate"`). `techStackLabels` = display labels shown in Titlebar.

Main process can read this synchronously via `readFileSync` in `run-claude` before building `args`, extract `techStacks` values, and use them to select SKILLS.md content.

---

## Q7: Where is SKILLS.md and what is its structure?

`docs/gotchas/SKILLS.md` — 36 lines. Structure:
```
## Planner
### Node.js / TypeScript
- <bullet>

## Coder
### Node.js / TypeScript
- <bullet>
```

Top-level `##` = agent names. `###` = tech stack names. Currently one stack defined. Agents already self-apply relevant sections: `planner.md` line 14: "If `docs/gotchas/SKILLS.md` exists, read it after `GENERAL.md`... Apply any section matching your agent name and the project's stacks."

**Stack-specific SKILLS.md is already per-project** (scaffold copies `templates/<stack>/docs/gotchas/SKILLS.md` → project). No changes to SKILLS.md structure needed.

---

## Recommendation: `--agents` JSON flag (Option A)

### Why not the alternatives
- **`--add-dir`** — does not extend `.claude/agents/` lookup path. Only grants file-read access. Not viable.
- **`~/.claude/agents/` global** — pollutes user's global namespace, prevents per-project customisation, conflicts with user-defined agents. Not recommended.

### Option A — `--agents` JSON flag

In `run-claude` handler, before building `args`:
1. Read all `.md` files from `join(app.getAppPath(), '.claude', 'agents')`
2. Parse `---` YAML frontmatter per file to extract `name`, `description`, `tools`, `model`
3. Treat file body (after frontmatter) as the `prompt` field
4. Construct `--agents` JSON object, append to args
5. Conditionally read project's `docs/gotchas/SKILLS.md` + `docs/gotchas/GENERAL.md` and append via `--append-system-prompt` if non-empty
6. Remove agent copy blocks from `scaffold-project` and `import-project`

### Trade-offs

| | `--agents` JSON | `--add-dir` | Global `~/.claude/agents/` |
|---|---|---|---|
| Removes per-project copies | ✓ | ✗ | ✓ |
| Agent discovery works | ✓ (per-run injection) | ✗ | ✓ |
| Stack injection | `--append-system-prompt` | N/A | `--append-system-prompt` |
| Code complexity | Medium (frontmatter parser) | N/A | Low |
| Per-project customisation | ✗ (all projects use FORGE agents) | N/A | ✗ |
| Ongoing maintenance | FORGE agents only | N/A | FORGE agents only |

### Remaining open question

**Per-project agent customisation:** If a project legitimately needs a custom agent (different model, extra tools, project-specific prompt), there is currently no override mechanism with Option A. One mitigation: check if `<projectFolder>/.claude/agents/*.md` files exist and merge them into the `--agents` JSON, with project files taking precedence over FORGE defaults. This preserves opt-in customisation without requiring full copies of all agents.
