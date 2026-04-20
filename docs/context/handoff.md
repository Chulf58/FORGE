# Handoff: Rename templates/ to scaffolds/

## Feature
Rename templates/ to scaffolds/

## Changes

### Directory rename
`git mv templates scaffolds`

### Reference updates

#### `CLAUDE.md`
- line 29 — `| Project templates | \`templates/\` |` → `| Project scaffolds | \`scaffolds/\` |`
- line 51 — `- \`templates/\` — project scaffolding templates` → `- \`scaffolds/\` — project scaffolding files`

#### `docs/gotchas/GENERAL.md`
- line 17 — `| Project templates | \`templates/\` | Directory trees copied by \`/forge:init\` |` → `| Project scaffolds | \`scaffolds/\` | Directory trees copied by \`/forge:init\` |`

#### `docs/ARCHITECTURE.md`
- line 20 — `| Project Templates | Scaffold templates for new project init | \`templates/\` |` → `| Project Scaffolds | Scaffold files for new project init | \`scaffolds/\` |`

#### `.pipeline/agent-roles.json`
- line 21 — `"templates/**"` in implementer allowedPaths → `"scaffolds/**"`
- line 24 — `"templates/**/docs/gotchas/SKILLS.md"` in skills-generator allowedPaths → `"scaffolds/**/docs/gotchas/SKILLS.md"`

#### `.pipeline/modules.json`
- line 128 — `"templates/code/CLAUDE.md"` → `"scaffolds/code/CLAUDE.md"`
- line 129 — `"templates/code-csharp/docs/"` → `"scaffolds/code-csharp/docs/"`
- line 130 — `"templates/power-automate/docs/"` → `"scaffolds/power-automate/docs/"`
- line 131 — `"templates/instructional/CLAUDE.md"` → `"scaffolds/instructional/CLAUDE.md"`

#### `agents/skills-generator.md`
- line 83 — `templates/code/docs/gotchas/skills/` → `scaffolds/code/docs/gotchas/skills/`

#### `agents/implementer-triage.md`
- line 31 — `src/`, `templates/`, `.pipeline/` → `src/`, `scaffolds/`, `.pipeline/`

#### `agents/researcher-triage.md`
- line 30 — `src/`, `templates/`, `.pipeline/` → `src/`, `scaffolds/`, `.pipeline/`

#### `agents/reviewer-triage.md`
- line 86 — `templates/code/CLAUDE.md` → `scaffolds/code/CLAUDE.md`

#### `hooks/workflow-guard.js`
- line 79 — `'/templates/'` → `'/scaffolds/'`

#### `docs/FORGE-REFERENCE.md`
- line 883 — `` `templates/code/` `` → `` `scaffolds/code/` ``
- line 884 — `` `templates/instructional/` `` → `` `scaffolds/instructional/` ``
- line 885 — `` `templates/power-automate/` `` → `` `scaffolds/power-automate/` ``

#### `docs/FORGE-OVERVIEW.md`
- line 255 — `FORGE gained a \`templates/\` directory` → `FORGE gained a \`scaffolds/\` directory`
- line 492 — `templates/code/CLAUDE.md` → `scaffolds/code/CLAUDE.md`
- line 501 — `templates/code/CLAUDE.md` → `scaffolds/code/CLAUDE.md`
- line 531 — `templates/code/docs/gotchas/skills/` → `scaffolds/code/docs/gotchas/skills/`

#### `docs/lean-lite-skip-audit-2026-04-19.md`
- line 131 — `### Gap 2: templates/ not in RISK_PATH_PATTERNS` → `### Gap 2: scaffolds/ not in RISK_PATH_PATTERNS`
- line 190 — `templates/ and scripts/ gaps are acceptable as-is` → `scaffolds/ and scripts/ gaps are acceptable as-is`

#### Files that move with the directory rename but contain internal self-references:

After `git mv templates scaffolds`, these three files exist at new paths. Their internal strings still say `templates/` and must be updated:

#### `scaffolds/code/.claude/agents/skills-generator.md` (was `templates/code/...`)
- line 74 — both occurrences of `templates/<stack>/docs/gotchas/SKILLS.md` → `scaffolds/<stack>/docs/gotchas/SKILLS.md`

#### `scaffolds/power-automate/.claude/agents/skills-generator.md` (was `templates/power-automate/...`)
- line 74 — both occurrences of `templates/<stack>/docs/gotchas/SKILLS.md` → `scaffolds/<stack>/docs/gotchas/SKILLS.md`

#### `scaffolds/instructional/.claude/agents/skills-generator.md` (was `templates/instructional/...`)
- line 74 — both occurrences of `templates/<stack>/docs/gotchas/SKILLS.md` → `scaffolds/<stack>/docs/gotchas/SKILLS.md`

---

### Files intentionally NOT updated
- `docs/CHANGELOG.md` — historical entries accurately describe what was done at the time; leave as-is
- `docs/archive/PLAN_HISTORY.md`, `docs/archive/CHANGELOG_HISTORY.md` — archived historical records
- `docs/PLAN-archive.md` — archived explore tasks
- `docs/RESEARCH/` — research notes, historical context only
- `docs/DECISIONS.md` — historical decision record; path reference at line 963 describes reasoning at decision time, not a live path dependency
- `.pipeline/board.json` — task description text strings; the rename task entry (line 1190) will be closed after apply; other entries are historical records
- `.pipeline/runs/` — run log records
- `.claude/settings.local.json` — stale approved-bash allowlist entries from old sessions; the `rm templates/...` commands ran at install time and are inert
- `mcp/node_modules/` — third-party SDK code using `resources/templates/list` (MCP protocol term, unrelated to our directory)

## Doc hints
arch-update: false
decision: false

## Verification: pre-flight clean
- No hook scripts modified (only the string `'/templates/'` in `workflow-guard.js` — a path segment in the write-guard allow-list, not a security boundary change)
- No routing/MCP logic modified
- No security-sensitive paths changed
- Directory rename is a `git mv`, preserving history
- All changes are string replacements of `templates/` → `scaffolds/` in path literals and documentation
- No behaviour changes — `scaffolds/` serves the identical role as `templates/`
