# FORGE-OVERVIEW & Slide Deck — Update Recipe

> This recipe describes how to update **FORGE-OVERVIEW.md** (the narrative document) and **pipeline-evolution.html** (the presentation slide deck). Follow it exactly when the user asks to update or refresh either.

---

## Core principle: FORGE-OVERVIEW.md is narrative only

FORGE-OVERVIEW.md is the **story of FORGE** — Eras, philosophy, competitive positioning, design decisions. It is NOT a reference manual. All technical reference data (agent tables, signal protocol, pipeline modes, module wiring, key files) lives in source-of-truth files and is never duplicated in the overview.

### What lives in FORGE-OVERVIEW.md

| Section | Type | Update trigger |
|---------|------|---------------|
| What Is FORGE? | Narrative | Major identity change only |
| The Glass Wall Principle | Philosophy | Almost never |
| FORGE vs Plain Claude CLI | Comparison table | When FORGE gains a capability that widens the gap |
| FORGE vs Similar Tools | Comparison table | When competitive landscape shifts |
| Why Use FORGE for New Projects | Narrative | When onboarding experience changes |
| **The Evolution — Eras** | **Narrative (centrepiece)** | **When a major milestone ships** |
| What's planned next | Data-driven | Every session (generated from board.json) |
| Design decisions | Narrative | When a feature is deliberately killed |

### What does NOT live in FORGE-OVERVIEW.md

These sections were removed. If the slide deck or a reader needs this data, read from the source-of-truth file directly:

| Data | Source of truth | Why not in overview |
|------|----------------|-------------------|
| Pipeline architecture & modes | `docs/gotchas/GENERAL.md` | Changes every few sessions |
| Gate system | `docs/gotchas/GENERAL.md` + gate component files | |
| Wave execution | `.claude/agents/implementer.md` | |
| Every agent — roles & models | `.claude/agents/*.md` frontmatter | Agents added/removed frequently |
| Signal protocol | `docs/gotchas/GENERAL.md` signal table | Signals added frequently |
| How FORGE assembles runs | `docs/ARCHITECTURE.md` + `runner.ts` | |
| Skills system | `docs/ARCHITECTURE.md` | |
| project.json fields | `docs/ARCHITECTURE.md` | |
| Custom agents & slots | `docs/ARCHITECTURE.md` | |
| Three-process architecture | `docs/ARCHITECTURE.md` | |
| Pipeline flow diagram | `docs/gotchas/GENERAL.md` | |
| Key files reference | `.pipeline/modules.json` keyFiles + `CLAUDE.md` | |
| Module wiring & capabilities | `.pipeline/modules.json` | |

---

## Part 1 — Updating FORGE-OVERVIEW.md

---

## Part 1b — Generating FORGE-REFERENCE.md

FORGE-REFERENCE.md is the **complete technical reference** — everything a technical colleague needs to understand FORGE's internals. It is generated on demand, never manually maintained. When the user says "update the reference doc" or "generate the reference", follow this recipe.

### Generation recipe

Read each source-of-truth file and assemble the following sections in order:

#### Section: Pipeline Architecture & Modes
- **Read:** `docs/gotchas/GENERAL.md` — pipeline types table, pipeline modes table
- **Write:** Reproduce both tables with brief intro prose explaining what pipeline types and modes are

#### Section: The Gate System
- **Read:** `docs/gotchas/GENERAL.md` — gate descriptions, `src/renderer/src/lib/gateDetector.ts` — gate logic
- **Write:** Describe Gate #1, Gate #2, TesterGate. What triggers each, what the user sees, what each approval choice does

#### Section: Wave Execution
- **Read:** `.claude/agents/implementer.md` — wave protocol section
- **Write:** What waves are, how tasks are annotated, what [wave-complete] and [blocked] signals mean

#### Section: Every Agent — Roles and Models
- **Read:** `.claude/agents/*.md` — parse YAML frontmatter (name, description, model) from every agent file
- **Cross-reference:** `SCAFFOLD_AGENT_NAMES` in `src/main/shared.ts`
- **Write:** Table grouped by pipeline stage: Plan | Implement | Review | Apply | On-demand. Columns: Agent | Model | Description

#### Section: The Signal Protocol
- **Read:** `docs/gotchas/GENERAL.md` — signal protocol table
- **Write:** Reproduce the signal table with intro explaining the startsWith + continue pattern

#### Section: How FORGE Assembles Agent Runs
- **Read:** `src/main/handlers/runner.ts` (run-claude handler), `src/main/shared.ts` (buildAgentsJson, buildSystemPromptAppend, ORCHESTRATOR_RULES)
- **Write:** Step-by-step walkthrough: settings read → mode detection → agent JSON build → system prompt assembly → spawn → stream parsing. No code, just the flow.

#### Section: One Chat Orchestrator
- **Read:** `src/main/shared.ts` (ORCHESTRATOR_RULES), `src/main/handlers/runner.ts` (one-chat wiring)
- **Write:** How one-chat mode works: conversational session, 90% context reduction, [run-pipeline] handoff, thinking suppression, enrichLevel injection

#### Section: Skills System
- **Read:** `src/main/shared.ts` (filterSkillsByCapabilities, resolveCapabilitiesForTask), `templates/code/docs/gotchas/skills/*.md`
- **Write:** Two delivery paths (template copy, skills-generator), runtime filtering, capability-scoped injection

#### Section: Project Configuration (project.json)
- **Read:** `src/main/handlers/project-json.ts`, `src/main/shared.ts` — all fields read from project.json
- **Write:** Field reference table: Field | Type | Purpose

#### Section: Custom Project Agents and Slots
- **Read:** `src/main/shared.ts` (buildAgentsJson slot logic)
- **Write:** What agent slots are, valid hook points, how configured in project.json

#### Section: Three-Process Architecture
- **Read:** `src/main/index.ts`, `src/preload/index.ts`
- **Write:** Main process (Node.js, handlers) | Preload (contextBridge) | Renderer (Svelte 5). What each owns, how they communicate.

#### Section: Module Map
- **Read:** `.pipeline/modules.json`
- **Write:** Table of all modules: Module | Description | Key Files | IPC Channels | Depends On | Used By. Then per-module capability lists.

#### Section: Key Files Reference
- **Read:** `.pipeline/modules.json` keyFiles, `CLAUDE.md` key source locations table
- **Write:** Table grouped by area: Main process | Preload | Renderer stores | Renderer components | Renderer lib | Agents | Templates

### FORGE-REFERENCE.md generation checklist

1. Delete the existing FORGE-REFERENCE.md (it's fully regenerated, not patched)
2. Read every source-of-truth file listed above
3. Assemble sections in order
4. Add a header: `# FORGE — Technical Reference` with a note: `> Generated on YYYY-MM-DD from source-of-truth files. Do not edit manually — regenerate with "update the reference doc".`
5. Write the file

---

### The Era section (the centrepiece)

Eras are the heart of the document and the slide deck. Each Era is a chapter in FORGE's story.

**When to add a new Era:** Only for major milestones — architectural shifts, UX paradigm changes, capability jumps. Not every feature. Examples that warranted Eras: first pipeline (Era 3), Gate #1 (Era 4), five reviewers (Era 6), pipeline modes (Era 10), One Chat Phase 1 (Era 17), Real One Chat (Era 18).

**How to write a new Era:**

1. Read `docs/CHANGELOG.md` and `docs/archive/CHANGELOG_HISTORY.md` for entries since the last Era
2. Identify the theme: what problem did this batch solve?
3. Write the **before state** — what was broken, missing, or painful
4. Write the **what changed** narrative — the solution, how it works, why it matters
5. Write the **what it exposed** — the next gap this revealed (sets up the next Era)
6. Add a **"Shipped in this era:"** bullet list from the CHANGELOG
7. End with a `---` separator

**Style:** Storytelling. Each Era should feel like a chapter. The reader should understand the progression: each Era's gap motivates the next Era's solution. Use concrete examples, not abstract descriptions. "The planner ran, but nobody checked its work" not "a review step was absent."

### Comparison sections (vs CLI, vs tools)

**FORGE vs Plain Claude CLI:**
- Source: `.pipeline/modules.json` capabilities (what FORGE does), general knowledge of Claude CLI (what it doesn't)
- Style: Two-column table. Each row = one thing FORGE adds. Keep it punchy.
- Update when: FORGE gains something the CLI doesn't have (e.g., One Chat conversational orchestrator)

**FORGE vs Similar Tools:**
- Source: `docs/competitive-eval.md` if it exists, otherwise general knowledge
- Style: Honest. Green where FORGE leads, red where it trails. Highlight structural differentiators (glass wall, gate system, multi-agent pipeline)
- Update when: Competitive landscape changes

### What's planned next

- Source: `.pipeline/board.json` — open items with `done: false`, prioritised
- How: Read board.json, filter high/medium priority. Group by theme. Write 1-2 sentences per item.
- Style: Forward-looking but grounded. Each item connects to a real gap.

### Design decisions — what FORGE deliberately does not do

- Source: `docs/DECISIONS.md` + hand-written rationale
- Style: "We tried X. Here's why we stopped." Prevents re-proposing killed ideas.
- Update when: A feature is deliberately killed or an approach permanently rejected.

### Stable sections (rarely touched)

- **What Is FORGE?** — Elevator pitch. Only update on major identity change.
- **The Glass Wall Principle** — Philosophy. Almost never changes.
- **Why Use FORGE** — Practical benefits narrative. Update when onboarding experience changes.

---

### FORGE-OVERVIEW.md update checklist

1. **Read the current FORGE-OVERVIEW.md**
2. **Read recent CHANGELOG entries** — what shipped since last update?
3. **Does a new Era warrant adding?** Ask the user if unsure — Eras are editorial decisions
4. **Add the new Era** following the recipe above
5. **Update "What's planned next"** from board.json
6. **Update comparison tables** if FORGE gained a differentiating capability
7. **Do NOT touch** the Glass Wall, What Is FORGE, or existing Era narratives unless asked
8. **Do NOT add reference data** (agent tables, signal lists, pipeline modes, module wiring) — that data lives in its source-of-truth files

---

## Part 2 — Slide Deck (pipeline-evolution.html)

### File location
`docs/pipeline-evolution.html` — self-contained HTML slide deck for presentations. Copies exist (`- Copy.html`, `- Copy (2).html`) — always edit the original.

### Architecture
Single HTML file with embedded CSS + JS. Slides defined as a JavaScript array (`SLIDES`). Keyboard navigation (arrow keys), progress bar, auto-scaling pipeline diagrams.

### Slide object structure

```js
{
  era: 'Era N · date',    // Header label (gold uppercase). Or: 'Deep Dive', 'Metaphor', 'Comparison', 'UI', 'Upcoming'
  title: 'Slide Title',   // Large bold title
  sub: 'Subtitle text',   // Italic dim subtitle (one line, narrative hook)
  desc: '<strong>New:</strong> ...', // Bottom bar (HTML, describes what's new)
  scale: 0.72,            // Pipeline diagram scale (smaller = more agents fit)
  fade: 0.15,             // Earlier-era fade (0.0 = visible, 1.0 = hidden)
  noYouRow: true,         // Optional: hide the "YOU" approval row
}
```

### Slide types

| Type | era field | Purpose | Pipeline diagram? |
|------|-----------|---------|-------------------|
| **Era** | `'Era N · date'` | Major milestone | Yes |
| **Deep Dive** | `'Deep Dive'` | Technical mechanism explainer | Varies |
| **Metaphor** | `'Metaphor'` | Conceptual analogy | No |
| **Comparison** | `'Comparison'` / `'Versus'` | Side-by-side | Sometimes |
| **Sibling** | `'Sibling Pipelines'` | debug/refactor/failed-test variants | Yes |
| **Project Types** | `'Project Types'` | Code vs Instructional | No |
| **Direct Mode** | `'Direct Mode'` | On-demand utility agents | Yes (simplified) |
| **Upcoming** | `'Upcoming'` | Roadmap | No |

### Pipeline diagram elements

- **Phase dividers:** `<div class="phase">PLAN PHASE</div>`
- **Agent boxes:** `<div class="ag est">planner</div>` — colour classes:
  - `est` = established (blue), `new` = new this era (green), `tri` = triage (purple), `aud` = audit (lilac)
- **Gate bars:** `<div class="gate"><span class="gate-lbl">GATE #1</span>...</div>`
- **Revision loops:** `<div class="rev-chip">↻ max 3</div>`
- **YOU row:** `<div class="you-row">YOU</div>`

### Compare column (right side)
- GSD comparison blocks, competitive comparison blocks
- Hidden on some slides (set via opacity/fade)

### How to add a new Era slide

1. Find the last Era slide in `SLIDES` array
2. Add new object after it (before special slides: Sibling, Comparison, Upcoming)
3. Fill in: `era`, `title`, `sub`, `desc`, `scale` (prev - 0.02), `fade` (prev - 0.02)
4. Build pipeline diagram: copy previous Era's rows, add new agents with class `new`, keep existing as `est`
5. Update compare column if relevant
6. Update Upcoming slide

### Data sources for slide content

The slide deck needs reference data that no longer lives in FORGE-OVERVIEW.md. Read from source-of-truth files:

| Slide needs | Read from |
|-------------|-----------|
| Agent names and models | `.claude/agents/*.md` frontmatter |
| Pipeline types and modes | `docs/gotchas/GENERAL.md` |
| Signal names and formats | `docs/gotchas/GENERAL.md` signal table |
| Module capabilities | `.pipeline/modules.json` |
| What's planned | `.pipeline/board.json` |
| Competitive comparison | `docs/competitive-eval.md` |
| Era narrative | `docs/FORGE-OVERVIEW.md` Eras section |
| Recent shipped items | `docs/CHANGELOG.md` |

### Slide deck update checklist

1. **Read the current SLIDES array**
2. **Read recent CHANGELOG entries** — what shipped?
3. **Does a new Era warrant a new slide?** Major milestones only
4. **Add the new Era slide** following the recipe
5. **Update Upcoming slide** — remove shipped items, add new roadmap from board.json
6. **Update Versus slide** if competitive landscape changed
7. **Read source-of-truth files** for any reference data the slide needs (agents, signals, modes)
8. **Check scale/fade progression** — continue the gradual decrease
9. **Do NOT modify existing Era slides** unless correcting factual errors
10. **Test** — open in browser, arrow through all slides
