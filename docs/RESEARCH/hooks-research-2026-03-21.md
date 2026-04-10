# Research: Agent Role Enforcement — Hook Mechanics

---

## Question 1: PreToolUse hook payload shape

**Finding:**

The full stdin JSON for a PreToolUse hook has the following confirmed schema (from the official Claude Code hooks reference at `https://code.claude.com/docs/en/hooks`):

```json
{
  "session_id": "string",
  "transcript_path": "string",
  "cwd": "string",
  "permission_mode": "default|plan|acceptEdits|dontAsk|bypassPermissions",
  "hook_event_name": "PreToolUse",
  "tool_name": "string",
  "tool_input": { ... },
  "tool_use_id": "string",
  "agent_id": "string (only present when hook fires inside a subagent)",
  "agent_type": "string (only present when hook fires inside a subagent)"
}
```

The two agent-identity fields are:
- `agent_id` — a unique runtime identifier for the subagent instance
- `agent_type` — the **name** of the agent, e.g. `"coder"`, `"reviewer-logic"`, `"Explore"`. For custom `.claude/agents/` agents this matches the agent filename without the `.md` extension.

These two fields are **only present** when the hook fires inside a subagent (i.e. Claude spawned via the `Agent` tool). They are absent when the hook fires in the top-level orchestrator session.

**What the local hooks already read:**

- `C:/Users/cuj/Forge/.claude/hooks/workflow-guard.js` reads `payload.tool_name` and `payload.tool_input` (lines 80–81). It does not read `agent_type` or `agent_id`.
- `C:/Users/cuj/Forge/.claude/hooks/ctx-post-tool.js` reads `payload.session_id`, `payload.tool_name`, and `payload.tool_input` (lines 19–23, 139). It does not read `agent_type` or `agent_id` either, but both would be available in the payload when running inside a subagent.

**On `CLAUDE_AGENT_NAME` as an environment variable:**

There is no `CLAUDE_AGENT_NAME` environment variable. The official documentation does not mention any such variable, and a GitHub issue (`#9567`) confirmed that hook environment variables are empty. The agent identity is delivered exclusively via the **stdin JSON payload** (`agent_type` field), not via process environment.

**Source:** `https://code.claude.com/docs/en/hooks`, local files `/C:/Users/cuj/Forge/.claude/hooks/workflow-guard.js` (lines 80–81) and `/C:/Users/cuj/Forge/.claude/hooks/ctx-post-tool.js` (lines 19–23)

**Recommendation:** The new role-enforcement hook should read `payload.agent_type` from stdin to identify the active agent. If `agent_type` is absent, the hook is firing in the orchestrator session, not a subagent — treat that as a pass-through. Only act when `agent_type` matches a known restricted agent name.

---

## Question 2: PreToolUse blocking mechanism

**Finding:**

There are two valid mechanisms to block a tool call from a PreToolUse hook:

**Method A — Exit code 2 (simplest):**
Exit the process with code 2. Claude Code treats this as a blocking error and cancels the tool call. The content of stderr is fed back to Claude as the error message. Stdout is ignored when exit code is non-zero.

```js
process.stderr.write('Blocked: reason here\n');
process.exit(2);
```

**Method B — JSON stdout with `hookSpecificOutput` (recommended, allows reason display):**
Exit 0 and write a JSON object to stdout:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "This agent is not permitted to call this tool."
  }
}
```

Valid `permissionDecision` values: `"allow"`, `"deny"`, `"ask"` (prompts user).

**What `additionalContext` does (advisory only):**
The existing `workflow-guard.js` uses `{ "additionalContext": "..." }` (line 107). This is NOT a block — it injects text into Claude's active session context but does NOT prevent the tool from executing. This is the advisory-only pattern.

**Deprecated / incorrect formats:**
- `{ "decision": "block", "reason": "..." }` — mentioned in some older docs as a legacy format; confirmed deprecated.
- `{ "approve": false }` — silently ignored (GitHub issue #4362, resolved July 2025).
- `{ "action": "block" }` — not a valid format; not documented.

**Source:** `https://code.claude.com/docs/en/hooks`, `https://github.com/anthropics/claude-code/issues/4362`, local file `/C:/Users/cuj/Forge/.claude/hooks/workflow-guard.js` line 107

**Recommendation:** Use Method B (`hookSpecificOutput` / `permissionDecision: "deny"`) for the role-enforcement hook. This is the current documented standard and provides a visible reason to the user. Use exit code 2 only as a fallback if the JSON output path fails. Do not use `additionalContext` alone — that only advises, it does not block.

---

## Question 3: Agent name availability in hooks

**Finding:**

When a subagent runs inside Claude Code, the hook receives `agent_type` in the stdin JSON payload. For custom agents defined in `.claude/agents/`, `agent_type` matches the agent's filename without the `.md` extension (e.g. the agent at `.claude/agents/coder.md` will have `agent_type: "coder"`).

There is **no environment variable** mechanism. The GitHub issue `#9567` (titled "Hook environment variables and $CLAUDE_TOOL_INPUT are always empty/unknown") confirmed that env-var passing to hooks is broken or unsupported. The correct and only reliable identification method is reading `agent_type` from the stdin JSON payload.

There is no sidecar file mechanism for agent identity. The `ctx-post-tool.js` hook uses a sidecar file (`claude-ctx-<sessionId>.json`) for context-window data, not agent identity — that data is written by a separate session-start hook, not by Claude Code itself.

**Sub-finding — hook fires inside the subagent's process context:**
When `agent_type` is present, the hook runs within the subagent's execution. This means it can use `process.cwd()` to get the project root (same as the top-level hook), which is how `workflow-guard.js` locates `.pipeline/run-active.json` (line 46).

**Source:** `https://code.claude.com/docs/en/hooks` (common input fields section), `https://github.com/anthropics/claude-code/issues/9567`

**Recommendation:** In the role-enforcement hook, detect subagent identity with:

```js
const agentType = payload.agent_type || null; // null means orchestrator
```

Then apply role rules against `agentType`. If `agentType` is null (orchestrator), allow all tools. If `agentType` is a known restricted agent (e.g. `"reviewer-logic"`, `"tester"`), apply the relevant tool allowlist/blocklist.

---

## Question 4: settings.json vs settings.local.json — which file to use

**Finding:**

Claude Code has four configuration scopes. Within a project, two files are relevant:

| File | Scope | Committed to git | Priority |
|---|---|---|---|
| `.claude/settings.json` | Project-wide (all team members) | Yes | Lower |
| `.claude/settings.local.json` | Local machine only (personal) | No — gitignored | Higher |

`.claude/settings.local.json` **overrides** `.claude/settings.json` when both define the same hook or permission.

**Current state of this project:**

- `.claude/settings.local.json` exists at `/C:/Users/cuj/Forge/.claude/settings.local.json` and already contains the PreToolUse hooks for `workflow-guard.js` (lines 150–169).
- `.claude/settings.json` does **not exist** in this project (confirmed: Glob returned no results for `.claude/settings.json`).

**The GENERAL.md claim:**
`docs/gotchas/GENERAL.md` does not mention settings.json vs settings.local.json at all. The original question's premise that GENERAL.md "says PreToolUse hooks go in settings.json" is not supported by the file content — GENERAL.md has no hook configuration guidance.

**Practical implication for this feature:**
All existing hooks live in `settings.local.json`. There is no `settings.json` to conflict with. The new role-enforcement hook should be added to `.claude/settings.local.json` to be consistent with the existing hook entries. If the feature is ever intended to be distributed to other machines via git, a separate `settings.json` entry would be appropriate — but that is a future concern.

**Source:** `https://code.claude.com/docs/en/settings`, local file `/C:/Users/cuj/Forge/.claude/settings.local.json` (lines 150–169), Glob search confirming no `.claude/settings.json` exists

**Recommendation:** Add the new PreToolUse hook entry to `.claude/settings.local.json`, directly in the existing `"PreToolUse"` array (after line 168). Do not create a new `settings.json` for this feature — it would be an orphan file with no team members to receive it, and would create a confusing split configuration.

---

## Summary table

| Question | Answer | Confidence |
|---|---|---|
| Payload fields | `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`, `agent_id` (subagent only), `agent_type` (subagent only) | High — from official docs |
| `CLAUDE_AGENT_NAME` env var | Does not exist | High — docs + issue #9567 |
| How to block | `hookSpecificOutput.permissionDecision: "deny"` (exit 0 + JSON stdout) OR exit code 2 | High — confirmed from docs + issue #4362 |
| `additionalContext` | Advisory only, does not block | High — local code confirms |
| Agent identity in hook | `payload.agent_type` — matches agent filename without `.md` | High — official docs |
| Which settings file | `settings.local.json` — consistent with existing hooks; no `settings.json` exists | Definitive — local file check |
