# Research: Subagent Hook Events

## Key facts

- Claude Code **fully supports** `SubagentStart` and `SubagentStop` hook events; both are documented and functional as of Feb 2025
- `SubagentStart` fires when a subagent is spawned via the Agent tool; payload includes `agent_id` and `agent_type`
- `SubagentStop` fires when a subagent finishes; payload includes `agent_id`, `agent_type`, `agent_transcript_path`, and `last_assistant_message`
- Both events support matchers to target specific agent types (e.g., `"Explore"`, `"security-reviewer"`, custom agent names)
- Postoomie hook scripts can write to stdout (for additionalContext), stderr, or exit code 2 to block; Agent tool completion does NOT support additionalContext, only stdout/stderr reporting

## Findings

### Question 1: Does Claude Code support SubagentStart and/or SubagentStop hook events? What are the exact event names?

**Finding:** Yes, both events are fully supported and documented in the official Claude Code hooks reference at https://code.claude.com/docs/en/hooks (as of Feb 2025).

- **Event name:** `SubagentStart` (exact case)
- **Event name:** `SubagentStop` (exact case)
- Both are part of the "Subagent Events" section of the hook lifecycle
- Matcher syntax follows the same pattern as tool-level hooks (e.g., `"matcher": "security-reviewer"`)

**Source:** https://code.claude.com/docs/en/hooks — official Claude Code documentation

**Recommendation:** Add both `SubagentStart` and `SubagentStop` hooks to `hooks/hooks.json` with matchers for the agent types you want to track (e.g., `"Agent"` to track all subagent spawns, or specific agent names like `"planner"`, `"coder"`, etc.).

---

### Question 2: What payload do these hooks receive on stdin?

**Finding:** Both hooks receive a JSON payload on stdin with these fields:

**SubagentStart payload:**
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "hook_event_name": "SubagentStart",
  "agent_id": "agent-abc123",
  "agent_type": "Explore"
}
```

**SubagentStop payload:**
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "permission_mode": "default",
  "hook_event_name": "SubagentStop",
  "stop_hook_active": false,
  "agent_id": "agent-def456",
  "agent_type": "Explore",
  "agent_transcript_path": "/path/to/subagent/transcript.jsonl",
  "last_assistant_message": "Analysis complete. Found 3 potential issues..."
}
```

Key fields:
- `agent_id`: Unique identifier for this subagent instance (e.g., `"agent-abc123"`)
- `agent_type`: Name of the agent type (e.g., `"Explore"`, `"security-reviewer"`, or custom agent name from `agents/*.md`)
- `agent_transcript_path`: (SubagentStop only) Path to the subagent's transcript file — can be read to extract detailed results
- `last_assistant_message`: (SubagentStop only) Final message from the subagent before it completed

**Source:** https://code.claude.com/docs/en/hooks — Hook input schemas for SubagentStart and SubagentStop

**Recommendation:** Write hook scripts that parse `agent_type` and `agent_id` to track which agents started/stopped. For `SubagentStop`, optionally read `agent_transcript_path` to extract structured results (e.g., reviewer verdicts, test outcomes). Follow the stdin/stdout pattern already used in `hooks/ctx-post-tool.js`: readline interface with timeout, JSON parse on close, fire-and-forget file writes to tmp.

---

### Question 3: Are there any other hook events we're not using that might be relevant?

**Finding:** Yes, several additional events might be relevant for pipeline tracking:

| Event | When | Relevance | Notes |
|-------|------|-----------|-------|
| `PreToolUse` (Agent) | Before Agent tool spawns subagent | High | Already implemented in FORGE hooks; fires before SubagentStart |
| `SessionEnd` | Session ends | Medium | Could log final agent counts, session summary; matchers: `clear`, `resume`, `logout`, etc. |
| `TaskCreated` | Task spawned via TaskCreate tool | Low | Not currently used in FORGE; relevant if agent teams / parallel agents implemented later |
| `TaskCompleted` | Task finishes | Low | Same as TaskCreated — future use |
| `Stop` | Claude finishes responding | Medium | Fires after each full turn; could summarize agent activity per turn |
| `Notification` | Notifications emitted (e.g., permission prompts) | Low | Not directly related to agent lifecycle |
| `InstructionsLoaded` | Project CLAUDE.md or `.claude/rules/*.md` loaded | Low | Useful for tracking when agent instructions change mid-session |

Most relevant additions: **`SubagentStart` and `SubagentStop`** (already confirmed); optionally **`SessionEnd`** for session-level summaries.

**Source:** https://code.claude.com/docs/en/hooks — complete hook event reference

**Recommendation:** Implement `SubagentStart` and `SubagentStop` first. Defer `SessionEnd` tracking unless you need cross-session aggregation or final reports.

---

### Question 4: If SubagentStart/Stop don't exist, what's the best alternative for tracking when agents spawn and complete?

**Finding:** This is moot — SubagentStart and SubagentStop **do exist**. No fallback needed.

However, if Claude Code ever removes these events, alternatives would be:
1. **PreToolUse (Agent) + PostToolUse (Agent):** Already in your hooks; fires when the Agent tool is invoked. Could track subagent spawns but not their internal lifecycle.
2. **Transcript polling:** Read `transcript_path` (from any hook payload) at intervals to detect agent role changes and message patterns — hacky and fragile.
3. **MCP server tool:** If built in the future, could offer structured agent lifecycle queries.

**Source:** Current hook implementation at `hooks/hooks.json` + https://code.claude.com/docs/en/hooks

**Recommendation:** Use `SubagentStart` and `SubagentStop` — they are the canonical, documented way. Your existing PreToolUse/PostToolUse hooks for Agent already detect spawning; SubagentStart/Stop let you track completion and access results.

---

## Implementation notes

1. **Update hooks.json:** Add two new hook groups:
   ```json
   "SubagentStart": [
     {
       "matcher": "*",
       "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/subagent-start.js\"" }]
     }
   ],
   "SubagentStop": [
     {
       "matcher": "*",
       "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/subagent-stop.js\"" }]
     }
   ]
   ```

2. **Create hook scripts:** Follow the pattern in `ctx-post-tool.js` — readline interface, stdin timeout, fire-and-forget logging to `os.tmpdir()`.

3. **Matcher strategy:** Use `"*"` to track all agent types, or list specific agents like `["planner", "coder", "researcher"]` if you want selective tracking.

4. **Transcript access:** In SubagentStop handler, optionally read `payload.agent_transcript_path` to extract agent output; this is where reviewer verdicts and structured results live.
