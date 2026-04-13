# Research: Context Re-injection on Mid-Session Compaction

> **Runtime correction (2026-04, Claude Code v2.1.104):** the original research below claimed PostCompact supports silent `additionalContext` / `systemMessage` injection. Live testing of all four output shapes proved otherwise — every shape is either rejected by the validator or echoed verbatim into `/compact`'s completion line. **PostCompact is not viable for context reinjection in the current runtime.** See `docs/gotchas/GENERAL.md` § "PostCompact hook — do not use for context reinjection" for the authoritative current behavior. The text below is preserved as research history.

## Key facts
- Claude Code **does have** `PostCompact` and `PreCompact` hook events; both fire mid-session when context fills. `SessionStart` also fires with `"compact"` matcher after resumption.
- `PostCompact` is non-blocking, receives `session_id`, `cwd`, `transcript_path`, `compaction_type` ("auto"|"manual"). Original research claimed outputs support `additionalContext` and `systemMessage` injection — **runtime testing disproved this**: any stdout shape is echoed visibly. See note above.
- `SessionStart` with `"compact"` matcher is the reliable re-injection point: fires after compaction completes and before the next turn begins.
- No hook event fires *after* compaction but *before* the next tool use — `SessionStart` fires at session resume, not mid-session compaction in the same session.
- GSD uses `UserPromptSubmit` as a proxy marker file: write a flag in `PreCompact`, check for it in `UserPromptSubmit`, inject rules, delete marker. This is the current workaround.

## Findings

### Question: Does Claude Code support a "compact" matcher on SessionStart hooks that fires when context is compacted mid-session?

**Finding:**

Yes and no. Two separate mechanisms exist:

1. **`SessionStart` with `"compact"` matcher:** Fires when a session *resumes* after compaction (e.g., user runs `claude --resume` after compaction). Does NOT fire during mid-session compaction in the same running session.

2. **`PostCompact` hook event:** Fires immediately after mid-session compaction completes (when context window fills). Payload includes `compaction_type: "auto"` or `"manual"`. *Originally believed to support `additionalContext` and `systemMessage` output injection — runtime testing in v2.1.104 showed all output shapes are echoed visibly into `/compact`'s completion line. See top-of-file correction.*

The semantic difference is crucial: `SessionStart` + `"compact"` matcher is for resuming sessions; `PostCompact` is for same-session re-injection.

**Source:** 
- [Hooks reference - Claude Code Docs](https://code.claude.com/docs/en/hooks)
- [Feature request: PostCompact hook event · Issue #32026 · anthropics/claude-code](https://github.com/anthropics/claude-code/issues/32026)

**Recommendation:** 

For mid-session compaction context re-injection, register a `PostCompact` hook (not `SessionStart`):

```json
{
  "PostCompact": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/ctx-post-compact.js\""
        }
      ]
    }
  ]
}
```

The script should:
- Read `transcript_path` from stdin to detect the compaction type
- Output `{ "systemMessage": "Critical rules: ..." }` to stdout on exit 0
- Never block (exit code 2 is not meaningful for PostCompact)

For resumption after compaction (cross-session), add a `SessionStart` hook with `"compact"` matcher:

```json
{
  "SessionStart": [
    {
      "matcher": "compact",
      "hooks": [
        {
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/ctx-session-start-compact.js\""
        }
      ]
    }
  ]
}
```

---

### Question: How does GSD actually do context reinjection — what specific hook config do they use?

**Finding:**

GSD does not use `PostCompact` (too new in Claude Code; pre-dates widespread adoption). Instead, GSD uses a **marker file + `UserPromptSubmit` proxy pattern**:

1. **PreCompact hook** writes a `.claude-compact-marker.json` file to `os.tmpdir()` with session ID
2. **UserPromptSubmit hook** checks for this marker *on every prompt*
3. If found, injects the preserved rules into the prompt and deletes the marker

This approach is fragile (file I/O on every prompt) but reliable across versions. GSD chose it because `PostCompact` landed in Claude Code only in late 2025, after GSD's hook strategy was locked.

**Source:** 
- [GitHub - Dicklesworthstone/post_compact_reminder: Claude Code hook that detects context compaction and injects a reminder](https://github.com/Dicklesworthstone/post_compact_reminder)
- [Claude Code Hooks: Complete Guide with Practical Examples](https://pasqualepillitteri.it/en/news/657/claude-code-hooks-complete-guide)

**Recommendation:** 

FORGE should prefer `PostCompact` over the GSD marker-file pattern. It is simpler, lower-latency, and now well-established. Use `PostCompact` for same-session re-injection and `SessionStart` + `"compact"` matcher for resumption.

---

### Question: What hook events fire mid-session (not just on start/stop)?

**Finding:**

Compaction-related mid-session events:
- **`PreCompact`** — fires before context compaction (auto or manual)
- **`PostCompact`** — fires after compaction completes, before next turn begins
- **`UserPromptSubmit`** — fires on every user prompt (can be used as a proxy hook)

Tool-execution mid-session events:
- **`PreToolUse`** — before every tool call
- **`PostToolUse`** — after every tool completes
- **`PostToolUseFailure`** — after tool fails
- **`PermissionRequest`** / **`PermissionDenied`** — permission dialog lifecycle
- **`Stop`** — when Claude finishes a response turn

All of these fire repeatedly during the session, not just at start/stop.

**Source:** [Hooks reference - Claude Code Docs](https://code.claude.com/docs/en/hooks)

**Recommendation:** 

For context re-injection specifically tied to compaction, use `PostCompact`. For continuous compliance checking during execution, continue using `PostToolUse` as FORGE already does.

