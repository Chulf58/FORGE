# Research: Documenter task board maintenance — Technical Findings

Date: 2026-03-18
Researcher: Claude Code (claude-sonnet-4-6)
Source: Direct read of all relevant source files.

---

## 1. `documenter.md` agent — current state

File: `.claude/agents/documenter.md`

**Frontmatter:**
```yaml
name: documenter
description: Updates CHANGELOG.md, ARCHITECTURE.md, and DECISIONS.md after a feature is implemented and tested. Last agent in the apply pipeline.
model: claude-sonnet-4-6
tools:
  - Read
  - Write
  - Glob
  - Grep
```

**What it currently does (4 steps):**
1. Prepend entry to `docs/CHANGELOG.md`
2. Update `docs/ARCHITECTURE.md` (folder structure, IPC table, data flow, store descriptions)
3. Optionally add to `docs/DECISIONS.md` (non-obvious technical decisions only)
4. Archive completed plan section in `docs/PLAN.md` — marks `### Feature: <name>` as `### [x] Feature: <name>`; if PLAN.md exceeds 150 lines, moves section to `docs/archive/PLAN_HISTORY.md`

There is also a **Step 5** mentioned in the current agent: "Module registry (AppModule in types)" — update a module's capability entry in the features store or `docs/MODULES.md` if it exists.

**Current output signal:**
```
Feature <name> documented. Changelog, Architecture, and Plan updated.
```

**Files it reads/writes:**
- Reads: `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/PLAN.md`
- Writes: `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/PLAN.md`, `docs/archive/PLAN_HISTORY.md`
- Does NOT currently touch `.pipeline/` at all

**Template counterpart:** `template/.claude/agents/documenter.md` does NOT exist yet — the template `.claude/agents/` directory is present but empty. The plan requires creating it as part of this feature.

---

## 2. `board.json` shape

File: `.pipeline/board.json`

**Exact structure observed:**
```json
{
  "todos": [ ... ],
  "planned": []
}
```

**`todos[]` item fields (from live data):**
- `id` — UUID string (format: `xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx`)
- `text` — string (full description)
- `done` — boolean
- `addedAt` — epoch ms (number)

**`planned[]` field:** Currently an empty array in the live board. The PLAN.md design specifies that planned items have a `title` field and a `moduleName` field. Based on the PLAN.md feature description:
- `title` — string (the feature name as typed by the user)
- `moduleName` — string (module identifier, e.g. `"pipeline-system"`)

**`moduleName` presence:** The PLAN.md design says `moduleName` is present on planned items but may be absent — the documenter must fall back to `""` if no match or no `moduleName`. This field is therefore **optional** and the agent must handle its absence gracefully.

**Critical note:** The `planned[]` array is currently empty in the live board. No live sample of a planned item is available for inspection. The field names `title` and `moduleName` come exclusively from the PLAN.md spec — the implementer must ensure the PlannedPanel stores items with exactly these field names when it writes board.json, for the documenter's matching logic to work.

---

## 3. `features.json` shape

File: `.pipeline/features.json`

**Exact structure (2 live entries observed):**
```json
[
  {
    "name": "Planner yes/no questions",
    "summary": "Before writing a plan the planner emits a [questions]/[/questions] block ...",
    "module": "pipeline-system",
    "date": 1742688000000
  },
  ...
]
```

**Fields:**
- `name` — string (feature name, verbatim)
- `summary` — string (1–2 sentence description)
- `module` — string (module ID; can be `""` for debug/refactor entries)
- `date` — number (epoch milliseconds)

**All fields appear in both entries — none are absent.** However `module` is `""` for debug/refactor entries per the design spec, so it is always present but may be empty string.

**Array order:** Most-recent-first (the design spec says prepend — confirmed by the array having the more recently planned feature first).

**File may not exist** on a fresh project — the documenter must create it as `[]` before appending when absent.

---

## 4. `handoff.md` heading format

File: `docs/context/handoff.md` (first 20 lines read)

**Exact H1 format:**
```
# Handoff: Planner yes/no questions
```

Pattern: `# Handoff: <Feature Name>` — a level-1 heading, the literal text `Handoff: `, followed by the feature name verbatim (including spaces, capitalisation, and any punctuation). This is always the very first line of the file.

**Extraction rule for the documenter:** Read line 1. Strip the `# Handoff: ` prefix (9 characters after `# `). What remains is the feature name exactly as the user typed it when they planned the feature.

---

## 5. How the documenter gets the project folder / working directory

**The documenter does NOT need a tool to find `.pipeline/`.**

From `src/main/index.ts` line 281:
```ts
cwd: isChat ? undefined : projectFolder,
```

Claude agents are spawned with `cwd` set to `projectFolder` — the active project's root directory. This means relative paths in Read/Write tool calls resolve directly against the project root.

**Implication:** The documenter already uses relative paths like `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`, etc. — these resolve to the correct project files without any path-finding logic. The same discipline applies to `.pipeline/board.json` and `.pipeline/features.json`. The agent writes `.pipeline/board.json` relative to cwd (= project root) and it just works.

**No tool call needed** to locate `.pipeline/`. The documenter does not need Glob or any path detection. It simply reads `.pipeline/board.json` directly.

---

## 6. JSON parse/write safety — gotchas

**The documenter must write raw JSON, not markdown-wrapped JSON.**

Key risks and rules:

1. **No markdown fences.** When the agent calls the Write tool to write `board.json` or `features.json`, the file content must be the raw JSON string only — no ` ```json ` fences, no leading/trailing prose. The Write tool writes the exact content string to disk.

2. **2-space indent.** The PLAN.md spec explicitly requires `JSON.stringify`-equivalent 2-space indented output. Both existing files (`board.json`, `features.json`) use 2-space indent consistently. The agent must match this.

3. **Preserve the full structure.** When writing `board.json` after removing a planned item, the documenter must write back the complete object including the `todos` array unchanged. A partial write (only `planned`) would corrupt the file.

4. **Treat missing files as `[]` not as an error.** `features.json` may not exist on a fresh project. The agent should use a Read-then-fallback pattern: if Read returns an error or empty content, start with `[]`.

5. **`board.json` may have `planned: []`** (empty array) — matching against an empty array must not crash; it should log and skip gracefully per the design spec.

6. **Epoch ms date.** The `date` field must be a number (milliseconds), not an ISO string. The agent has today's date in context (2026-03-18) — it should compute `new Date('2026-03-18').getTime()` equivalent, which is `1742256000000`. However since the agent cannot execute code, it must output the numeric value directly. The existing entries use round numbers (e.g. `1742688000000`) — the agent should use midnight UTC for the current date.

7. **Case-insensitive title matching.** The spec says match `planned[].title` to the handoff feature name case-insensitively with `.trim()`. The agent must normalise both sides to lowercase before comparing. This is important because the user may have typed the title with different casing than the handoff heading preserves.

---

## Summary: what needs to be implemented

Based on findings:

- **Step 0 (new):** Read `docs/context/handoff.md` line 1, strip `# Handoff: ` prefix to get feature name. Determine mode from the invocation prompt.
- **Step 5 (new, feature mode only):** Read `.pipeline/board.json` with fallback on missing file. Case-insensitive trim match on `planned[].title`. Remove matched item. Write full board back (both `todos` and `planned`) with 2-space indent. Capture matched item's `moduleName` (may be absent — default `""`).
- **Step 6 (new, all modes):** Read `.pipeline/features.json` with fallback `[]` on missing/empty. Compose entry with `name`, `summary`, `module`, `date`. Prepend. Write with 2-space indent.
- **Output signal update:** Two variants — feature mode and debug/refactor mode.
- **Template file:** Create `template/.claude/agents/documenter.md` as a copy of the updated `.claude/agents/documenter.md` — it does not currently exist.

**No new IPC, no new tools, no path-finding needed.** The documenter already has Read + Write + Glob + Grep and runs with cwd = project root.
