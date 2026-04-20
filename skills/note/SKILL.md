---
name: forge:note
description: "Add or browse knowledge notes. Use when: user wants to capture information, make a note, or review notes."
argument-hint: "[optional: note text]"
allowed-tools: "Read Write"
---

Manage FORGE knowledge notes. Prefer MCP tools: `forge_add_note` to add, `forge_read_notes` to list/search, `forge_delete_note` to remove. Fall back to reading `.pipeline/notes.json` directly if MCP unavailable.

No arguments: list all notes, most recent first.
With arguments: add as new note. If the text contains hashtag-style tags (e.g. #salesforce #integration), extract them into the `tags` array and strip them from the text.

$ARGUMENTS
