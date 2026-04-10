# Research: Agent Scaffolding & Project Identity Review

**Date:** 2026-03-20
**Scope:** Three planned features — scaffold agent set fix, project-agnostic identity, sync-agents IPC

---

## 1. Are the three plans correct and complete?

### Feature 1 — Fix scaffold agent set and scaffoldProject copy

**Current state (confirmed by reading `src/main/index.ts` lines 41–48):**

```ts
const SCAFFOLD_AGENT_NAMES = new Set([
  'planner.md', 'researcher.md', 'gotcha-checker.md', 'coder.md',
  'reviewer.md', 'reviewer-safety.md', 'reviewer-logic.md', 'reviewer-style.md',
  'reviewer-performance.md', 'reviewer-triage.md', 'implementer.md', 'tester.md',
  'documenter.md', 'debug.md', 'refactor.md', 'architect.md', 'GENERAL.md',
])
```

The plan correctly identifies two problems:

- **`architect.md` is missing** — FALSE. `architect.md` is already in the set at line 47.
- **`GENERAL.md` is a phantom** — CORRECT. `GENERAL.md` is not an agent file; it lives in `docs/gotchas/GENERAL.md`, not `.claude/agents/`. Its presence in `SCAFFOLD_AGENT_NAMES` means it would be treated as a scaffold agent for deletion-guard purposes (`delete-agent` handler at line 413 checks this set), which is harmless in practice but semantically wrong. More importantly it pollutes the sync logic: if the `sync-agents` handler (Feature 3) iterates `SCAFFOLD_AGENT_NAMES` to know what to copy, it will try to copy a file named `GENERAL.md` from `srcAgentsDir` — which does not exist there.

**`scaffoldProject` copy (line 810–842):**

The plan says scaffoldProject "copies the whole agents dir unfiltered." This is confirmed:

```ts
if (existsSync(agentsSrc)) copyDirRecursive(agentsSrc, join(targetFolder, '.claude', 'agents'))
```

`copyDirRecursive` is a recursive function that copies everything, including any subdirectories that might exist under `.claude/agents/`. The plan's fix (tighten the copy to use the `SCAFFOLD_AGENT_NAMES` whitelist) is correct.

**Contrast with `import-project`:** The import path (lines 749–762) already correctly filters using `SCAFFOLD_AGENT_NAMES`:

```ts
for (const f of agentFiles) {
  if (!SCAFFOLD_AGENT_NAMES.has(f)) continue
  ...
  await fsPromises.copyFile(srcFile, destFile)
}
```

So `importProject` is already tightened; only `scaffoldProject` needs fixing.

**Gap in the plan:** The plan does not specify what happens to `GENERAL.md`'s role in the `delete-agent` guard. Currently `GENERAL.md` in `SCAFFOLD_AGENT_NAMES` prevents deletion of a file named `GENERAL.md` from `.claude/agents/`. Removing it from the set is safe because no agent file by that name should ever exist in `.claude/agents/`. This removal is low-risk and the plan correctly removes it, but the implementer should be aware that the deletion guard is the only place this matters — no other code paths depend on `GENERAL.md` being in the set.

**Verdict:** Plan is correct. The `architect.md` note in the plan prompt appears to be wrong (it was already in the set), but the GENERAL.md removal is valid. Net change: remove `GENERAL.md` from the set; tighten `scaffoldProject` to use the set as a filter.

---

### Feature 2 — Project-agnostic agent identity

**Current state (confirmed by reading agent files):**

- `planner.md` line 12: `"You are the Planner for FORGE — a desktop Electron app built with Svelte 5, TypeScript, and electron-vite."`
- `coder.md` line 12: `"You are the Coder for FORGE — a desktop Electron app built with Svelte 5, TypeScript, and electron-vite."`
- `architect.md` line 12: `"You are the Architect agent. You run on whatever the active FORGE project is — not on FORGE itself."` — already fully generic

The plan correctly identifies 15 agents needing the opening line replaced and categorises them into two groups: (a) 8 agents needing only the opening line changed, (b) 7 agents with FORGE-specific tech stack content in body sections also needing a qualifying note.

**Specific findings per agent group:**

The plan's Task 2 says: "The `architect.md` (already fully generic) and `template/.claude/agents/documenter.md` (already says 'for this project') are excluded." Both confirmed correct.

The plan's `.claude/agents/documenter.md` is listed in the 8-agent group (opening line only). Confirmed: `documenter.md` in `.claude/agents/` (not template) still has the hardcoded FORGE opening — the plan is right to include it.

**The plan's "Research needed" items (still open):**

1. "Confirm whether `reviewer.md` body section 'given Electron's three-layer architecture and the IPC contract' (line 15) should be qualified." — This body text describes what the reviewer checks in the handoff artifact (which is FORGE-generated). If the active project is not FORGE, the handoff will still describe an IPC contract (whatever IPC means for that project). The phrase "Electron's three-layer architecture" is FORGE-specific and would be wrong for a non-Electron project. **Recommendation:** qualify it with a GENERAL.md override note, same as the other body sections.

2. "Confirm whether `refactor.md`'s `## FORGE-specific refactoring goals` section needs the same qualifying note." — Since the section title says "FORGE-specific," it is self-documenting, but a note at the top of that section saying "these apply when the active project is FORGE" would be cleaner. The plan lists refactor.md in the opening-line-only group, which undercounts — it should be in the body-sections group alongside coder.md.

**Verdict:** Plan is mostly correct. Two gaps: (a) `reviewer.md` line 15 body text should be in the body-sections group, not opening-line-only group; (b) `refactor.md` `## FORGE-specific refactoring goals` also needs a qualifying note — it is currently in the opening-line-only group.

---

### Feature 3 — sync-agents IPC handler

**Plan completeness:** The four-file IPC quadruple is covered (constants.ts, claude.d.ts, index.ts, ipc.ts). The modal changes (state variables, function, button, feedback, styles) are fully specified. The plan is detailed and covers all required locations.

**Critical gap — asar packaging (the plan's own "Research needed" item):**

Looking at `electron-builder.yml`:

```yaml
asarUnpack:
  - resources/**
files:
  - '!**/.vscode/*'
  - '!src/*'
  ...
```

The `.claude/` directory is NOT listed in `asarUnpack`. The `files` array uses exclusion patterns only (everything not excluded is included). There is no explicit inclusion of `.claude/` in `asarUnpack` or `extraResources`.

In electron-vite builds, `app.getAppPath()` returns the path to the `app.asar` archive in production. Files inside an asar archive can be read via Electron's virtual filesystem but **cannot be copied from using `fs.copyFileSync`** — `fs` operations on asar-packed paths fail with `ENOENT` or similar errors for write-like operations. `existsSync` also behaves unexpectedly on asar paths in some Node versions.

The existing `scaffold-project` handler (line 817) already uses the same `join(appRoot, '.claude', 'agents')` pattern, so this is a pre-existing risk that affects both `scaffoldProject` and the new `sync-agents` handler equally. If `scaffoldProject` currently works in packaged builds, the same approach will work for `sync-agents`. But if it is only tested in dev mode (where `app.getAppPath()` returns the real project directory), it may silently fail in packaged builds.

**Specific risk:** `asarUnpack: ['resources/**']` only unpacks the `resources/` directory. The `.claude/` and `template/` directories at the app root are packed inside the asar. Any `fs` operations that write or copy from inside the asar will fail in packaged builds.

**Recommendation:** Add `.claude/agents/**` and `template/**` to `asarUnpack` in `electron-builder.yml`, or move them into the `resources/` directory which is already unpacked. This affects all three features since both `scaffoldProject` and `importProject` also use this path.

---

## 2. Other affected code areas the plans missed

### `AgentModal.svelte` — duplicate `SCAFFOLD` set

`AgentModal.svelte` lines 7–12 maintains its own hardcoded copy of the scaffold agent names:

```ts
const SCAFFOLD = new Set([
  'planner.md', 'researcher.md', 'gotcha-checker.md', 'coder.md',
  'reviewer.md', 'reviewer-safety.md', 'reviewer-logic.md', 'reviewer-style.md',
  'reviewer-performance.md', 'reviewer-triage.md', 'implementer.md', 'tester.md',
  'documenter.md', 'debug.md', 'refactor.md', 'architect.md',
])
```

Note: this copy already correctly excludes `GENERAL.md` (it was never in the renderer copy). The comment says "must stay in sync with main/index.ts SCAFFOLD_AGENT_NAMES." When Feature 1 removes `GENERAL.md` from the main-side set, the renderer copy needs no change (it already matches the intended final state). This is not a risk but worth confirming during implementation.

### `constants.ts` — `AGENT_META` is missing `architect`

`constants.ts` line 24 already includes `architect` in `AGENT_META`. No gap here.

### `constants.ts` — `AGENT_META` model flags are stale

`AGENT_META` shows `reviewer-performance` as `model: 'sonnet'` and `reviewer-triage` as `model: 'sonnet'`. The completed plan features (Switch to Haiku) have updated the `.md` frontmatter but `constants.ts` has not been updated to match. This is a cosmetic issue (model badges in the UI would show the wrong model) but is outside the scope of the three features being reviewed here. It should be tracked separately.

### `delete-agent` guard (line 413)

This handler checks `SCAFFOLD_AGENT_NAMES.has(safe)` before allowing deletion. When `GENERAL.md` is removed from the set, the guard no longer blocks deletion of a hypothetical `.claude/agents/GENERAL.md`. As noted, this is safe — no such file should exist. No functional regression.

### `analyze-import` handler (line 581)

Uses `SCAFFOLD_AGENT_NAMES` to classify files as scaffold vs custom agents during the import analysis step. The current code:

```ts
if (SCAFFOLD_AGENT_NAMES.has(f)) scaffoldAgents.push(f)
```

This feeds the `ImportAnalysis.scaffoldAgents` array shown to the user in the import UI. Removing `GENERAL.md` from the set means a file named `GENERAL.md` in a project's `.claude/agents/` dir would be classified as a custom agent instead of scaffold. This is correct behaviour — it shouldn't be in agents at all.

---

## 3. Project-agnostic identity approach assessment

**The approach is sound.** Replacing the opening identity line with "You are the X agent. You run as part of the FORGE pipeline for the active project. Read `docs/gotchas/GENERAL.md` for project-specific context before acting." is the right pattern. The Architect agent already uses exactly this form and it works well.

**What the replacement line must do:**

1. Establish the agent's role name (preserved)
2. Establish that context comes from `docs/gotchas/GENERAL.md`, not from the agent's own hardcoded stack assumptions
3. For agents with embedded FORGE tech stack in their bodies, a qualifying "these are FORGE defaults; GENERAL.md takes precedence" note is required — the plan correctly identifies this

**What NOT to do:**

- Do not remove the FORGE-specific tech stack sections entirely. They serve as useful fallback examples when `docs/gotchas/GENERAL.md` is thin or missing. The "GENERAL.md overrides" framing preserves their value while removing the incorrect assertion that the active project IS FORGE.
- Do not add a read-ARCHITECTURE.md instruction to the opening line. `docs/ARCHITECTURE.md` is a project output document; `docs/gotchas/GENERAL.md` is the agent-instructions document. GENERAL.md is the right pointer.

**On the `reviewer.md` body text "given Electron's three-layer architecture":**

This phrase appears in the context of what the reviewer is checking (handoff.md correctness). For a non-Electron project, this guidance becomes misleading. The fix is: replace "Electron's three-layer architecture and the IPC contract" with "the project's architecture and IPC contract (see `docs/gotchas/GENERAL.md` for the actual stack)." This is a body-section fix, not just an opening line fix — the plan currently undersells this agent's changes.

---

## 4. Ordering dependencies between the three features

**Recommended implementation order:**

1. **Feature 1 first** (fix `SCAFFOLD_AGENT_NAMES` and `scaffoldProject`). This is a pure backend fix with no UI surface. It is a prerequisite for Feature 3 because: the `sync-agents` handler will iterate `SCAFFOLD_AGENT_NAMES` to decide which files to copy. If `GENERAL.md` is still in the set when `sync-agents` runs, the handler will attempt to copy `<appRoot>/.claude/agents/GENERAL.md`, find it does not exist (because it lives in `docs/gotchas/`, not `.claude/agents/`), and silently skip it — which is safe but messy. Fixing the set first makes the sync handler clean from the start.

2. **Feature 3 second** (sync-agents IPC and UI). This depends on Feature 1 only for the clean set; otherwise it is independent. Implement and test the IPC plumbing before the identity changes so the sync mechanism is in place.

3. **Feature 2 last** (agent identity). This is purely a content change to 15 `.md` files. It has no code dependencies. Doing it last means it can be applied using the sync mechanism added in Feature 3 — after the identity is fixed in FORGE's own agents, a single "SYNC TO LATEST" press in any project will propagate the updated agents. This is the logical completion of the feature set.

**There are no hard blocking dependencies between 2 and 3** — they can be implemented in either order. But implementing 3 first makes 2 self-deploying to existing projects.

---

## 5. Risks in the sync-agents IPC approach

### Risk 1 — asar packaging (HIGH)

As detailed in Section 1 above: `app.getAppPath()` in a packaged build returns a path inside `app.asar`. Node's `fs.copyFileSync` and `fs.existsSync` do not reliably handle asar paths for source files when you need to read raw file bytes (not require/import). The `asarUnpack` config only covers `resources/**`.

**Mitigation required:** Either:
- Add `.claude/**` to `asarUnpack` in `electron-builder.yml` (simplest fix, affects scaffold-project too)
- Or use `app.isPackaged` to switch between `app.getAppPath()` (dev) and `process.resourcesPath` (packaged) with agents in `resources/.claude/agents/`

The existing `scaffoldProject` handler has the same risk. If it has been tested in packaged builds and works, then `sync-agents` will work the same way — but the root cause should be investigated rather than assumed safe. **This is the highest-priority risk in the entire three-feature set.**

### Risk 2 — Renderer-side `confirm()` in Electron (LOW)

The plan uses `confirm()` for the sync confirmation dialog. In Electron's renderer process with `contextIsolation: true`, `window.confirm()` is blocked by default (returns true without showing a dialog). This is a known Electron quirk.

FORGE may already work around this (the renderer likely uses a custom modal system for confirmations). If `confirm()` is currently used elsewhere in the renderer and works, no issue. If not, the plan's confirmation step will silently pass without asking the user — the sync will run immediately.

**Recommendation:** Check whether `confirm()` works in the FORGE renderer before implementing. If not, use the existing modal system (or a simple inline state flag with a "confirm" UI state in the modal itself) instead.

### Risk 3 — `DELETE_AGENT` guard inconsistency after sync (LOW)

After a sync, scaffold agents in the project are overwritten with FORGE's latest versions. The `delete-agent` handler guards against deleting scaffold agents. This is correct: scaffold agents should not be deletable. No regression from the sync operation.

### Risk 4 — Race condition on `loadAgents()` after sync (VERY LOW)

The plan calls `loadAgents()` immediately after the sync IPC resolves. Since the sync is synchronous on the main-process side (uses `copyFileSync` in the future handler), the files will be written before the IPC response returns. The `loadAgents()` call after receiving the response is safe.

---

## Summary table

| Feature | Plan Correctness | Key Gap | Risk |
|---------|-----------------|---------|------|
| 1 — Fix scaffold set | Correct (note: architect.md was already present) | `GENERAL.md` phantom removal is the real fix | Low |
| 1 — Fix scaffoldProject copy | Correct | Confirm asar packaging also affects this | High (asar) |
| 2 — Agent identity | Mostly correct | `reviewer.md` body and `refactor.md` body undersold | Low |
| 3 — sync-agents IPC | Correct and complete | asar path resolution untested in packaged build; `confirm()` may not work in renderer | High (asar), Low (confirm) |

**Top recommendation before implementing Feature 3:** Verify that `app.getAppPath()` + direct `fs` operations on `.claude/agents/` works in a packaged build. If not, add `.claude/**` to `asarUnpack` in `electron-builder.yml` — this also fixes the latent risk in `scaffoldProject` and `importProject`.
