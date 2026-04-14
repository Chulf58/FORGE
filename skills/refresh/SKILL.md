---
name: forge:refresh
description: "Run the FORGE knowledge refresh -- maintain the docs/solutions/ knowledge store. Use when: user wants to clean up stale solutions or maintain the knowledge base."
argument-hint: "[optional: focus area]"
context: fork
allowed-tools: "Read Write Glob Grep Agent"
---

Run the FORGE knowledge refresh -- maintain the docs/solutions/ knowledge store.

Invoke the **compound-refresh** agent. It reviews all solution docs against the current codebase:
- Flags stale docs where referenced files have been deleted or renamed
- Identifies duplicate/overlapping solutions
- Archives stale docs to docs/solutions/archive/
- Reports aging docs for manual review

This is a maintenance command -- run it periodically to keep the knowledge store accurate.

$ARGUMENTS
