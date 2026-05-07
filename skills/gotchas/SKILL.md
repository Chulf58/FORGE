---
name: forge:gotchas
description: "Project conventions and known pitfalls. Preloaded into agents via skills frontmatter so they can self-check against project conventions without prompt bloat."
argument-hint: ""
allowed-tools: "Read Grep Glob"
model: claude-haiku-4-5-20251001
---

## Purpose

This skill gives agents on-demand access to project-specific conventions and known pitfalls. Instead of every agent prompt containing "Read docs/gotchas/GENERAL.md", agents with `skills: ["forge:gotchas"]` can reference these conventions when needed.

## How to use

When writing or reviewing code, check your work against these sources:

1. **Project conventions:** Read `docs/gotchas/GENERAL.md` — project-specific rules that override all defaults.
2. **Stack conventions:** Read `docs/gotchas/SKILLS.md` if it exists — stack-specific patterns for the agent's role (read only your agent's section and matching stack sections).
3. **Known patterns:** Call `forge_get_constraints` with keywords from the files you're touching. Call `forge_get_patterns` with module/file names to find past solutions.
4. **Decisions:** Read `docs/DECISIONS.md` if it exists — recorded architectural decisions that constrain implementation choices.

## Quick checks

Before finalizing your work, verify:

- **Async:** Every async call is `await`ed. Handlers have `try/catch`. No fire-and-forget without comment.
- **Edge cases:** Empty input, missing files, null/undefined returns are handled at system boundaries.
- **No `any` types:** Use `unknown` and narrow, or define the type.
- **No `console.log`** in committed code.
- **No commented-out code.**
- **2-space indent**, single quotes, semicolons, trailing commas in multi-line.

## Write-back

If you discover a project-specific pitfall not covered in `GENERAL.md`, call `forge_add_learning(type: 'gotcha', ...)` to record it. Only call this when `forge_get_patterns` or `forge_get_constraints` was available and returned no matching result — skip write-back during MCP fallback to prevent duplicates.
