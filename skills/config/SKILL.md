---
name: config
description: "View or update FORGE project settings. Use when: user wants to change pipeline mode, tester setting, or view project config."
argument-hint: "[optional: key value]"
allowed-tools: "Read Write"
---

View or update FORGE project settings. Prefer MCP tools: `forge_read_project` to view, `forge_update_config` to update. Fall back to reading `.pipeline/project.json` directly if MCP unavailable.

With no arguments: show config (mode, tester, safe, stacks, version).
With arguments: update. Format: `<key> <value>`. Keys: mode (lean/standard/full), tester (off/ask/on), safe (true/false).

$ARGUMENTS
