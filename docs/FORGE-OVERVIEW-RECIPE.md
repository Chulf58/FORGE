# FORGE-OVERVIEW & FORGE-REFERENCE — Update Recipe

> This recipe describes how to update **FORGE-OVERVIEW.md** (the narrative document) and **FORGE-REFERENCE.md** (the technical reference). Follow it exactly when the user asks to update or refresh either.

---

## Core principle: two documents, two purposes

| Document | Purpose | Style | Update method |
|----------|---------|-------|---------------|
| FORGE-OVERVIEW.md | Story of FORGE — Eras, philosophy, competitive positioning, design decisions | Narrative, storytelling | Targeted edits, append-only for Eras |
| FORGE-REFERENCE.md | Complete technical reference — everything a developer needs to understand FORGE internals | Factual, structured, code examples | Full regeneration from source-of-truth files |

Neither document duplicates the other. The overview tells the story. The reference has the specs. Cross-references connect them.

---

## Part 1 — Updating FORGE-OVERVIEW.md

### What lives in FORGE-OVERVIEW.md

| Section | Type | Update trigger |
|---------|------|---------------|
| What Is FORGE? | Narrative | Major identity change only (e.g., Electron → plugin) |
| The Glass Wall Principle | Philosophy | Almost never |
| FORGE vs Plain Claude CLI | Comparison table | When FORGE gains a capability that widens the gap |
| FORGE vs Similar Tools | Comparison tables | When competitive landscape shifts or new research arrives |
| Why Use FORGE for New Projects | Narrative | When onboarding experience changes |
| **The Evolution — Eras** | **Narrative (centrepiece)** | **When a major milestone ships** |
| What's planned next | Data-driven | Every update (generated from board.json) |
| Design decisions | Narrative | When a feature is deliberately killed or an approach permanently rejected |

### What does NOT live in FORGE-OVERVIEW.md

Reference data lives in source-of-truth files and is assembled into FORGE-REFERENCE.md:

| Data | Source of truth |
|------|----------------|
| Pipeline architecture & modes | `CLAUDE.md`, `docs/gotchas/GENERAL.md` |
| Agent tables (names, models, descriptions) | `agents/*.md` frontmatter |
| Signal protocol | `docs/gotchas/GENERAL.md` |
| Hook inventory | `hooks/hooks.json`, `hooks/*.js` |
| MCP tools | `mcp/server.js` |
| Model routing | `mcp/lib/*.js` |
| Key files reference | Actual file inventory |
| Module wiring | `.pipeline/modules.json` |
| Skills inventory | `skills/*/SKILL.md` |
| Project configuration fields | `docs/gotchas/GENERAL.md`, `CLAUDE.md` |

---

### The Era section (the centrepiece)

Eras are the heart of the document. Each Era is a chapter in FORGE's story.

**When to add a new Era:** Only for major milestones — architectural shifts, capability jumps, distribution model changes. Not every feature. Examples that warranted Eras: first pipeline (Era 3), Gate #1 (Era 4), five reviewers (Era 6), pipeline modes (Era 10), One Chat (Era 17-18), plugin pivot (Era 19).

**How to write a new Era:**

1. Read `docs/CHANGELOG.md` and `docs/archive/CHANGELOG_HISTORY.md` for entries since the last Era
2. Identify the theme: what problem did this batch solve?
3. Write the **before state** — what was broken, missing, or painful
4. Write the **what changed** narrative — the solution, how it works, why it matters
5. Write the **what it exposed** — the next gap this revealed (sets up the next Era)
6. Add a **"Shipped in this era:"** bullet list from the CHANGELOG
7. End with a `---` separator

**Style:** Storytelling. Each Era should feel like a chapter. The reader should understand the progression: each Era's gap motivates the next Era's solution. Use concrete examples, not abstract descriptions.

### Comparison sections

**FORGE vs Plain Claude CLI:**
- Source: actual plugin capabilities (agents, hooks, MCP tools, skills) vs vanilla Claude Code
- Style: Two-column table. Each row = one thing FORGE adds. Keep it punchy.
- Update when: FORGE gains something the CLI doesn't have

**FORGE vs Similar Tools (GSD, Compound Engineering, Cursor, Aider, etc.):**
- Source: `docs/RESEARCH/*.md` for real competitive data. Fall back to general knowledge only when no research exists.
- Style: Honest. Highlight structural differentiators. Acknowledge where competitors lead.
- Update when: New research arrives or competitive landscape changes

### What's planned next

- Source: `.pipeline/board.json` — filter `done: false`, group by theme
- How: Read board.json, count open items, group by theme (pipeline, knowledge, distribution, validation, parallel sessions). Write 1-2 sentences per theme.
- Style: Forward-looking but grounded. Each item connects to a real gap.

### Design decisions

- Source: `docs/DECISIONS.md` + hand-written rationale
- Style: "We tried X. Here's why we stopped." Prevents re-proposing killed ideas.
- Update when: A feature is deliberately killed or an approach permanently rejected.

### FORGE-OVERVIEW.md update checklist

1. **Read the current FORGE-OVERVIEW.md** — understand what exists
2. **Read recent CHANGELOG entries** — what shipped since last update?
3. **Does a new Era warrant adding?** Ask the user if unsure — Eras are editorial decisions
4. **Add the new Era** following the recipe above
5. **Update "What's planned next"** from board.json
6. **Update comparison tables** if FORGE gained a differentiating capability or new research exists
7. **Update "What Is FORGE?"** only if the identity changed (rare)
8. **Update "Why Use FORGE"** only if onboarding experience changed
9. **Do NOT touch** the Glass Wall or existing Era narratives unless asked
10. **Do NOT add reference data** (agent tables, signal lists, hook inventories) — that data lives in FORGE-REFERENCE.md

---

## Part 2 — Generating FORGE-REFERENCE.md

FORGE-REFERENCE.md is the **complete technical reference** — everything a developer needs to understand FORGE's internals. It is regenerated from source-of-truth files on demand. When the user says "update the reference doc" or "generate the reference", follow this recipe.

### Source files to read

Before writing anything, read ALL of these:

| Source | What to extract |
|--------|----------------|
| `CLAUDE.md` | Pipeline types, modes, key source locations |
| `docs/gotchas/GENERAL.md` | Signal protocol, pipeline modes, conventions |
| `agents/*.md` (all 28+) | YAML frontmatter: name, description, model, tools, maxTurns, effort |
| `skills/*/SKILL.md` (all 18+) | Skill name, description, which agents invoked, pipeline sequence |
| `hooks/hooks.json` | Event types, matchers, script paths |
| `hooks/*.js` (all scripts) | First 30-50 lines: what each does, blocks or advisory, stdin/stdout pattern |
| `mcp/server.js` | All registerTool calls: tool name, description, inputSchema fields, read-only |
| `mcp/lib/*.js` | Module purposes, key functions, patterns |
| `.mcp.json` | Server declaration |
| `.claude-plugin/plugin.json` | Plugin version, name, description |
| `.pipeline/modules.json` | Module inventory |
| `.pipeline/board.json` | Open items count (for "What's planned") |
| `docs/DECISIONS.md` | Recent architecture decisions |
| `forge-config.default.json` | Model routing defaults |

### Section structure (in order)

The reference doc must contain these sections in this order. Each section explains both WHAT exists and HOW it works.

#### Section 1: Pipeline Architecture & Modes
- **Read:** `CLAUDE.md` pipeline tables, `docs/gotchas/GENERAL.md`
- **Write:** Pipeline types table (type → skill → agent set → gate). Pipeline modes table (mode → when → effect). Count-based triage rule.

#### Section 2: The Gate System
- **Read:** `skills/approve/SKILL.md`, `skills/discard/SKILL.md`, `docs/gotchas/GENERAL.md`
- **Write:** Gate #1 (triggers, what user sees, actions), Gate #2 (same), gate state via MCP (gate-pending.json, forge_check_gate, forge_set_gate).

#### Section 3: Wave Execution
- **Read:** `agents/implementer.md` — wave protocol section
- **Write:** What waves are, application order, wave self-check, [wave-complete] and [blocked] signals.

#### Section 4: Every Agent — Roles and Models
- **Read:** All `agents/*.md` — parse YAML frontmatter (name, description, model, maxTurns, effort)
- **Write:** Table grouped by pipeline stage: Plan | Implement | Review | Apply | Debug/Refactor | On-demand. Columns: Agent | Model | Description. Then agent tiers table (Heavy/Medium/Light with maxTurns and effort).

#### Section 5: The Signal Protocol
- **Read:** `docs/gotchas/GENERAL.md` — signal protocol table
- **Write:** Full signal table with format and purpose. Reviewer verdict JSON fields. Health aspects.

#### Section 6: How a Pipeline Run Executes (THE KEY SECTION)
- **Read:** `skills/plan/SKILL.md`, `skills/implement/SKILL.md`, `skills/apply/SKILL.md`, `skills/chat/SKILL.md`
- **Write:** The execution model (skills are Markdown orchestrator prompts, not external runners). Step-by-step walkthrough of /forge:plan, /forge:implement, /forge:apply. Data flow diagram (which files each agent reads/writes). The self-improvement feedback loop (audit log → tool-call-auditor → [auditor-recurring] → agent-optimizer → Gate #2 → implementer applies prompt fixes).

#### Section 7: Hook Technical Protocol
- **Read:** `hooks/bash-guard.js` (blocking example), `hooks/ctx-stop.js` (advisory example), any hook script first 30 lines
- **Write:** Input protocol (JSON payload shapes per event type). Output protocol (stdout JSON, stderr, exit codes). Safe stdin reading pattern (readline + timeout). Two worked examples: one blocking (bash-guard) and one advisory (ctx-stop).

#### Section 8: Skills (User Commands)
- **Read:** All `skills/*/SKILL.md` — name, description from frontmatter
- **Write:** Tables grouped by role: Pipeline skills (with agent sequence and gate), Gate skills, Status/data skills, Setup skills.

#### Section 9: Hook Inventory
- **Read:** `hooks/hooks.json`, all `hooks/*.js` first 30 lines
- **Write:** Inventory table (script | event | what it does | blocks?). Event types summary table. Cross-reference to Section 7 for protocol details. Enforcement model summary.

#### Section 10: MCP Server & Tools
- **Read:** `mcp/server.js` — all registerTool calls with descriptions and input schemas. `.mcp.json`.
- **Write:** Server architecture (entry point, deps, declaration, auto-install). Project directory resolution. Tool inventory grouped by domain (board, config, pipeline state, modules, model routing). Tool registration pattern with Zod example. Error handling pattern. JSON read/write pattern. Transport (StdioServerTransport, no console.log).

#### Section 11: Model Routing
- **Read:** `mcp/lib/router.js`, `mcp/lib/config-store.js`, `mcp/lib/usage-store.js`, `mcp/lib/openai-adapter.js`, `forge-config.default.json`
- **Write:** Architecture table (4 lib modules). Two-track routing (Anthropic via frontmatter, external via forge_call_external). Config file resolution (CLAUDE_PLUGIN_DATA primary, .pipeline fallback). API key handling (envVar only, never plaintext). The 4-priority fallback chain explained step by step. Budget modes (soft preference at priority 3 only).

#### Section 12: Project Configuration (project.json)
- **Read:** `docs/gotchas/GENERAL.md`, `CLAUDE.md`
- **Write:** Field reference table. Git integration config with JSON example and safety constraints.

#### Section 13: Module Map
- **Read:** `.pipeline/modules.json`
- **Write:** Table of all modules with key files.

#### Section 14: Key Files Reference
- **Read:** Actual file inventory via Glob
- **Write:** Tables grouped by area: Plugin infrastructure, Agents, Skills, Hook scripts, MCP server, Utility scripts, Templates, Pipeline data (per project).

#### Section 15: Documentation Structure
- **Write:** Tier table (overview, reference, recipe). Principle statement. Other docs table.

### FORGE-REFERENCE.md generation checklist

1. **Delete the existing FORGE-REFERENCE.md** — it is fully regenerated, not patched
2. **Read every source-of-truth file listed above** — do not write from memory
3. **Count everything:** agents (expect 28+), skills (expect 18+), hooks (expect 11+), MCP tools (expect 17+), lib modules (expect 4+). State counts in the doc.
4. **Assemble sections in order** per the structure above
5. **Add header:** `# FORGE — Technical Reference` with generated-on date and do-not-edit note
6. **Add footer:** list all source files read during generation
7. **Verify:** grep for stale references (Electron, Svelte, IPC, src/main, src/renderer, .claude/agents/) — there should be zero

---

## Part 3 — Slide Deck (pipeline-evolution.html)

### File location
`docs/pipeline-evolution.html` — self-contained HTML slide deck for presentations.

### How to add a new Era slide

1. Find the last Era slide in `SLIDES` array
2. Add new object after it (before special slides: Sibling, Comparison, Upcoming)
3. Fill in: `era`, `title`, `sub`, `desc`, `scale` (prev - 0.02), `fade` (prev - 0.02)
4. Build pipeline diagram: copy previous Era's rows, add new agents with class `new`, keep existing as `est`
5. Update compare column if relevant
6. Update Upcoming slide

### Data sources for slide content

| Slide needs | Read from |
|-------------|-----------|
| Agent names and models | `agents/*.md` frontmatter |
| Pipeline types and modes | `CLAUDE.md`, `docs/gotchas/GENERAL.md` |
| Signal names and formats | `docs/gotchas/GENERAL.md` signal table |
| Module capabilities | `.pipeline/modules.json` |
| What's planned | `.pipeline/board.json` |
| Competitive comparison | `docs/RESEARCH/*.md` |
| Era narrative | `docs/FORGE-OVERVIEW.md` Eras section |
| Recent shipped items | `docs/CHANGELOG.md` |

### Slide deck update checklist

1. **Read the current SLIDES array**
2. **Read recent CHANGELOG entries** — what shipped?
3. **Does a new Era warrant a new slide?** Major milestones only
4. **Add the new Era slide** following the recipe
5. **Update Upcoming slide** — remove shipped items, add new roadmap from board.json
6. **Update Versus slide** if competitive landscape changed
7. **Read source-of-truth files** for any reference data the slide needs
8. **Check scale/fade progression** — continue the gradual decrease
9. **Do NOT modify existing Era slides** unless correcting factual errors
10. **Test** — open in browser, arrow through all slides
