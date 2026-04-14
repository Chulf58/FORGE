# Handoff: UX and discoverability

## Overview

This session delivered three UX/discoverability improvements: command-collision deconfliction, a startup-banner investigation, and a new `/forge:help` discoverability surface.

## Session commits (in order)

| Commit | Subject |
|---|---|
| `fdc0b6c` | fix(commands): stop FORGE config from shadowing native /config |
| `59039ee` | fix(commands): namespace all FORGE skill names |
| `f7cdf2c` | feat(help): add /forge:help discoverability surface |

## What shipped

### Command-collision deconfliction (`fdc0b6c`, `59039ee`)

Fixed a confirmed collision where `/config` resolved to FORGE config instead of Claude Code's native `/config`. Root cause: skills used bare `name:` fields that participated in intent routing alongside native commands.

Applied a blanket `forge:` prefix to all 20 FORGE skill `name:` fields. The display layer already showed them as `forge:*`, so this aligns internal names with user-facing names — zero UX change.

**Policy established:** all FORGE skill `name:` fields must use the `forge:` prefix. New skills must follow this convention.

### `/forge:help` discoverability surface (`f7cdf2c`)

New skill at `skills/help/SKILL.md`. Compact quick reference with four sections:
1. **Header** — one-line description of what FORGE is
2. **Core commands** — grouped list of the most important commands
3. **Right now** — 1–3 state-aware suggestions derived from `forge_dashboard_state`
4. **Where to look** — pointers to status, dashboard, and overview

Uses `forge_dashboard_state` as sole data source. No direct `.pipeline/*` reads. Output capped at ~40 lines.

## What was investigated but not shipped

### Startup banner — Windows direct-console output

Investigated whether a SessionStart hook can produce truly visible startup output on Windows by writing to the `CON` device (Windows equivalent of Unix `/dev/tty`). Findings:

- `fs.writeFileSync('CON', ...)` succeeds in Node.js on Windows and bypasses stdio capture
- However, a full isolation test proved that **the native Claude welcome screen suppression is not caused by any SessionStart hook** — it's caused by the plugin system itself (`--plugin-dir` flag or plugin infrastructure)
- Even with all three SessionStart hooks replaced by silent no-ops, the welcome screen remained absent
- Conclusion: startup banner as a visible surface is a Claude Code runtime limitation when plugins are loaded, not something FORGE can fix via hooks

The experimental `CON` change was reverted. The `forge-banner.js` hook remains as-is (stderr + `additionalContext` for model awareness).

## Core contracts (preserve in any future change)

1. **Skill `name:` fields always use `forge:` prefix.** New skills must follow this convention.
2. **Commands in `commands/forge/` are auto-namespaced by folder structure.** No prefix needed in the file's `name:` field.
3. **Bare commands outside `commands/forge/` are acceptable only when no native collision exists** (e.g., `ping`).
4. **`/forge:help` uses `forge_dashboard_state` only.** No direct `.pipeline/*` reads.

## Deferred

- Dashboard welcome/help panel (embed help content in the sidecar HTML)
- Optional move of `commands/ping.md` to `commands/forge/ping.md` for consistency
- Monitor Anthropic's command additions for any that collide with `forge:*` namespaced names
- Investigate whether Claude Code's plugin SDK offers a formal namespace declaration

## Next recommended slice

Dashboard welcome/help panel, Diesel Priser e2e validation, or the TERMINAL_STATUSES/PIPELINE_STAGE_LABELS consolidation refactor.
