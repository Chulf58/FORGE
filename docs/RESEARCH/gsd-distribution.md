# Research: GSD Distribution

## Key facts
- GSD is distributed as an **npm package** (`get-shit-done-cc`), not a Claude Code marketplace plugin
- Primary install: `npx get-shit-done-cc@latest` or `npm i get-shit-done-cc`
- Secondary: clone from GitHub (`gsd-build/get-shit-done`) for source access
- GSD works across 9 runtimes (Claude Code, Copilot, Gemini CLI, Cursor, Windsurf, etc.), not just Claude Code

## Findings

### Distribution model

**Finding:** GSD is an **npm-based global CLI installer**, not a Claude Code native plugin. It auto-configures agents, commands, and hooks into the target runtime's config directory at install time.

**Source:** [GSD GitHub](https://github.com/gsd-build/get-shit-done), [Medium article](https://agentnativedev.medium.com/get-sh-t-done-meta-prompting-and-spec-driven-development-for-claude-code-and-codex-d1cde082e103)

**Implication:** FORGE follows a different distribution model — bundled as a Claude Code `.plugin.json` manifest, not an npm CLI. This is a design choice trade-off: npm packages reach broader audiences but lose tight coupling to a single IDE; plugin-native approach keeps the plugin isolated.

---

### Installation methods

**Finding:** GSD installs globally or locally via `npx get-shit-done-cc@latest` with flags for runtime (`--claude`, `--opencode`, `--gemini`, etc.) and scope (`-g`, `-l`). It modifies the target runtime's config directory directly.

**Source:** [Installation guide (DeepWiki)](https://deepwiki.com/gsd-build/get-shit-done/2.1-installation), GitHub `/bin/install.js`

**Implication:** No marketplace dependency; users invoke from any project. FORGE requires `/forge:init` in each target project, which is more explicit but requires per-project setup.
