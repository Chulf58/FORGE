# Non-Filesystem Projects — Feasibility Research
_Completed: 2026-03-22_

## Question
Can FORGE manage projects that live inside external applications (Postman, Power Automate, Genesys Cloud Architect) rather than in a local folder?

## Verdict
**No — don't pursue.** Fundamental mismatch between FORGE's agent model and configuration/design systems. Higher ROI via vertical integrations (Postman Flows, Azure Copilot, Genesys Developer Tools).

---

## Current filesystem coupling

FORGE is deeply tied to a local `projectFolder` path at multiple layers:

- **Claude CLI `cwd`** — the entire run executes with the project folder as working directory
- **`.pipeline/` state files** — 7 required files (board.json, modules.json, features.json, project.json, etc.) that agents read/write directly during runs
- **`.claude/agents/`** — agent definitions synced into each project folder
- **`docs/gotchas/GENERAL.md`** / `SKILLS.md` — injected as system prompt append
- **IPC handlers** — every handler in main/index.ts does `join(projectFolder, ...)` with no abstraction layer

### Thin-wrapper model

Theoretically feasible: create a local `~/.forge/projects/<id>/` folder holding `.pipeline/` + docs/ + agents/, then sync external state into it before runs and push changes back after. The Claude CLI would run against the local folder and never know the difference.

**What still breaks:** FORGE agents (coder, implementer, reviewer, etc.) are written for code projects. They use Glob/Read/Edit tools on source files. If the "project" is a Postman collection or Power Automate flow, there's no source tree for them to work with — and the agent personalities don't translate.

---

## Per-tool analysis

### Postman
- Collections are JSON; could be synced locally via Postman API ✓
- No "source code" for agents to read/review ✗
- No testing loop (Claude can't run Postman tests locally) ✗
- Fit: **Low**

### Power Automate
- Flows are cloud-only JSON; Microsoft Graph API access ✓
- Non-linear execution model (parallel branches, loops) doesn't map to linear TODO board ✗
- No local test environment ✗
- Microsoft Copilot is already in Flow Designer ✗
- Fit: **Very low**

### Genesys Cloud Architect
- Visual state-machine flows; exportable as JSON via Genesys API ✓
- Domain-specific validation rules (state transitions, exit conditions) ✗
- No local execution environment ✗
- Fit: **Low**

---

## What would be needed (if pursued anyway)

1. Abstract `projectFolder: string` into `project: { id, service, externalId, localFolder }` across session store, all IPC handlers, and preload — ~500–800 lines
2. Sync layer per tool (fetch before run, push after) — ~300–500 lines per tool
3. New CLAUDE.md templates per domain (Postman pipeline, flow-design pipeline) — significant agent work
4. New agent personalities (no coder/reviewer/tester makes sense for config systems)

**Estimated cost per tool:** 1,000–2,000 lines + new agent definitions. Three tools = substantial new product vertical, not a FORGE feature.

---

## Recommendation

Close the todo. If non-filesystem workflows become a priority in future, the right approach is vertical integration inside the target tool (Postman Flows, Azure Copilot in Power Automate Designer, Genesys Developer Tools) rather than trying to route those workflows through FORGE's filesystem-based pipeline.
