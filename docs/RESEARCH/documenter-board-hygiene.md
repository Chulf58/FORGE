# Research: Documenter board hygiene — auto-mark todos done, add end-of-session protocol to CLAUDE.md

## Question 1: What does the documenter currently do with board.json?

**Finding:**

The documenter agent has two current steps for board.json management (Step 5 and Step 5b), both feature-mode-only:

**Step 5 — Remove from planned board:**
- Reads `.pipeline/board.json`
- Uses a three-stage matching strategy to find a planned item that corresponds to the just-shipped feature:
  - **Stage 1:** Exact substring match (case-insensitive) — feature name contained in planned title or vice versa
  - **Stage 2:** Word overlap — count shared significant words (≥4 chars, excluding stopwords); match if ≥2 words
  - **Stage 3:** Most recent — fallback using highest `addedAt` timestamp
- Removes the first (single) matched item from `planned[]`
- Logs which stage was used and warnings if multiple Stage-1 matches
- Writes board back with 2-space indent

**Step 5b — Close matching todos:**
- Uses the board.json already read in Step 5 (no re-read)
- Searches `todos[]` for entries where `done: false` AND `text` contains feature name (case-insensitive substring)
- For each match: sets `done: true` and adds `doneAt: <current epoch ms>`
- Writes board back (same rules as Step 5)
- Logs match count or "no open todos matched"
- Skipped entirely if board.json unreadable or mode is `debug`/`refactor`

The documenter does **not** currently:
- Close todos that have significant word overlap (only substring match)
- Purge stale completed todos
- Apply fallback strategies (Stage 2/3) when closing todos

**Source:** `.claude/agents/documenter.md` lines 127–173

---

## Question 2: What is the exact JSON shape of todos/planned/completed entries?

**Finding:**

Board.json has only two top-level arrays: `todos` and `planned`. There is no `completed` array — completed items remain in `todos[]` with `done: true`.

### Todo entry structure:

```json
{
  "id": "string (kebab-case identifier)",
  "priority": "high|medium|low",
  "text": "string (can be multiline with \n)",
  "done": true|false,
  "addedAt": number (epoch milliseconds),
  "doneAt": number (epoch milliseconds, OPTIONAL — only present if done: true),
  "tags": ["string", ...]
}
```

**Key observations:**
- `done` is always present and boolean
- `doneAt` is OPTIONAL — observed in some `done: true` entries (e.g., id "reviewer-style-to-haiku" with `doneAt: 1774648384846`) but NOT all of them (e.g., id "sprint-mode-implementation" has `done: true` but no `doneAt` field)
- Entries are never removed from `todos[]`; they accumulate indefinitely unless manually purged
- The array preserves insertion order

Example completed todo WITH `doneAt`:
```json
{
  "id": "reviewer-style-to-haiku",
  "priority": "high",
  "text": "TOKEN COST: Change reviewer-style's model...",
  "done": true,
  "addedAt": 1743120000010,
  "doneAt": 1774648384846,
  "tags": ["token-cost", "performance", "reviewer-style", "model", "quick-win"]
}
```

Example completed todo WITHOUT `doneAt`:
```json
{
  "id": "sprint-mode-implementation",
  "priority": "high",
  "text": "FEATURE: Implement SPRINT pipeline mode...",
  "done": true,
  "addedAt": 1774771200000,
  "tags": ["feature", "pipeline", "sprint", "mode", "pre-qa"]
}
```

### Planned entry structure:

```json
{
  "id": "string (kebab-case identifier)",
  "title": "string",
  "description": "string (optional)",
  "moduleName": "string (optional, can be empty "")",
  "status": "shipped|pending|...",
  "addedAt": number (epoch milliseconds),
  "doneAt": number (epoch milliseconds, OPTIONAL)
}
```

**Source:** `.pipeline/board.json` lines 2–1363; grep confirms `done` and `doneAt` fields present throughout

---

## Question 3: What's currently in the CLAUDE.md FORGE-on-FORGE section?

**Finding:**

The FORGE-on-FORGE constraint section at `CLAUDE.md` lines 34–36 currently reads:

```markdown
## FORGE-on-FORGE constraint

FORGE must never be set as the active project in FORGE's own UI. When working on FORGE source files, use Claude Code CLI directly (this context). When working is a pipeline-appropriate task (new feature, bug fix, refactor), state the reasoning and proposed approach before acting — direct edits and pipeline agents are both valid choices.
```

It contains:
- Statement that FORGE must not be active in its own UI
- Instruction to use Claude Code CLI for source work
- Permission to choose between direct edits or pipeline agents for pipeline-appropriate tasks (with reasoning requirement)

What's **missing:**
- Any protocol for end-of-session cleanup/documentation
- Any mention of running the documenter agent as a final step
- No guidance on when/how to write handoff.md before running agents

**Source:** `CLAUDE.md` lines 34–36

---

## Summary for Coder

The plan's scope is now fully understood:

1. **Step 5b extension:** Currently matches only substring; needs to broaden to Stage 2 (word overlap) with fallback Stage 3 (most-recent), mirroring Step 5's existing three-stage strategy. Must add explicit log lines for each stage used.

2. **New Step 5c:** Purge completed todos where `done: true` AND `doneAt` is older than 7 days (604800000 ms). Logs count or "no stale" message. Must handle missing `doneAt` field gracefully (keep entries without it).

3. **CLAUDE.md end-of-session protocol:** Add paragraph to the FORGE-on-FORGE constraint section specifying that after direct-edit sessions touching >1 FORGE file, the documenter agent must run as final step, with exact invocation format and note about pre-writing handoff.md.

4. **One-time board cleanup:** Direct edit to `.pipeline/board.json` — manually purge all current `done: true` todos that lack a recent `doneAt` (>7 days old or absent), leaving only `done: false` and recently-done entries.

**Recommendation:** Implement in the order: Plan Step 5b extension (reusable word-overlap logic), then Step 5c (stale purge), then CLAUDE.md prose addition. The word-overlap logic is the most complex and will set the pattern for todo matching.
