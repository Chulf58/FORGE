# FORGE Rules — Survive Compaction

These rules are re-injected after context compaction. They are LAWS, not suggestions.

## Tool Selection
- Use Read for file reads (not cat/head/tail via Bash)
- Use Grep for pattern search (not grep/rg via Bash)
- Use Glob for file finding (not find/ls via Bash)
- Use Edit for file edits (not sed/awk via Bash)
- Use Write for file creation (not echo > via Bash)
- Bash is ONLY for: git, npm, node, process ops, test runners
- Minimize total token cost across all calls — pick whichever tool path is cheapest

## Approach-First Law
- Before ANY task: present pipeline, mode, full agent team with reasons
- Show data flow (numbered file list with changes)
- WAIT for explicit user approval before touching any file
- "I like the suggestion" is NOT approval. Present formal approach, get distinct "yes"/"approved"

## Pipeline Mode Selection
- Direct = ZERO RISK only (renames, docs, config values)
- If there's a sequence with failure modes → needs reviewers
- If it runs shell commands, writes external systems, has state transitions → needs pipeline
- Gate #1 and #2 require explicit user approval ALWAYS

## Implementation Rules
- Skip tester agent — go directly from implementer to documenter
- Never start implementation without approval
- Read actual files before making decisions — never theorize
- Read agent/skill prompts to understand how they work before invoking them

## Token Conservation
- Fewer tool calls = fewer tokens. One call that answers the question beats three
- Don't use Agent tool for simple file reads — use Read/Grep/Glob directly
