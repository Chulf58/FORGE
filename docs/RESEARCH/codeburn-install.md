# Research: Codeburn Installation

## Key facts
- NPM package: `codeburn` — install globally or use `npx` for one-off runs
- Requires Node.js 20+; reads Claude Code session data directly from disk (`~/.claude`)
- No API keys, proxies, or wrappers needed — pure local token cost analysis
- Use `CLAUDE_CONFIG_DIR` env var to override the session data directory if needed

## Findings

### npm package name

**Finding:** The package is published as `codeburn` on npm.  
**Source:** https://github.com/AgentSeal/codeburn  
**Recommendation:** Reference as `codeburn` in any setup docs.

---

### Install command

**Finding:** Install globally with:
```bash
npm install -g codeburn
```
Or run without installing:
```bash
npx codeburn
```

**Source:** https://github.com/AgentSeal/codeburn  
**Recommendation:** Document both paths — global install for frequent use, `npx` for one-off checks.

---

### How to run

**Finding:** Launch the interactive terminal dashboard by default:
```bash
codeburn
```

Common subcommands:
- `codeburn today` — view today's usage
- `codeburn month` — this month's data
- `codeburn report -p 30days` — rolling 30-day window
- `codeburn status` — compact one-liner summary
- `codeburn optimize` — find waste patterns and fixes

**Source:** https://github.com/AgentSeal/codeburn  
**Recommendation:** The dashboard (no args) is the primary interface; subcommands are optional for scripting/filtering.

---

### Configuration and gotchas

**Finding:** 
- Requires **Node.js 20+** — verify before install
- Reads session data directly from `~/.claude` (Claude Code default) — no API keys needed
- Override the session directory with `CLAUDE_CONFIG_DIR` env var if using a non-standard Claude Code installation
- Detects installed AI coding tools automatically (Claude Code, Codex, Cursor, OpenCode, Pi, Copilot)
- Currency setting via `codeburn currency <CODE>` (e.g. `codeburn currency GBP`)

**Source:** https://github.com/AgentSeal/codeburn  
**Recommendation:** Check `node --version` before install. No auth setup needed — the tool is purely local introspection.
