# Research: Enforcement Mechanisms in Claude Code Plugins

## Key facts

- **PreToolUse blocking is the enforcement backbone:** Exit code 2 or JSON `permissionDecision: "deny"` blocks actions before they execute; this is the ONLY hook that can prevent tool use and cannot be bypassed by `--dangerously-skip-permissions`
- **Read-before-edit is solved via PreToolUse (Haiku prompt hook):** GSD uses a prompt-based PreToolUse hook on `Edit|Write` matchers to detect and warn (non-blocking) when files are edited without being read first; Opus 4.6 systematically attempts edits without reading, confirming model-level behavior
- **Exit code 2 forces agent re-planning:** When a PreToolUse hook exits with code 2, stderr becomes the agent's feedback, so the agent receives the rejection reason and must adjust its plan — it does not trigger a permission dialog
- **PostToolUse runs after execution (too late to block):** Used for validation, formatting, and logging only; cannot prevent bad actions, only catch and report them
- **No mutable tool restrictions via frontmatter exist:** Agent `tools` frontmatter only declares what an agent is allowed to use; GSD and Compound Engineering rely entirely on PreToolUse hooks to enforce workflow structure, not tool access control

## Findings

### Question 1: Do they use PreToolUse/PostToolUse hooks to block bad behavior?

**Finding:**
GSD, Compound Engineering, and all open-source enforcement-focused plugins (disciplined-process-plugin, claude-hooks, claude-code-showcase) use **PreToolUse hooks exclusively for blocking**. PostToolUse is never used for prevention — only for post-execution auditing, formatting, and logging.

**GSD's enforcement pattern:**
- `gsd-prompt-guard.js`: PreToolUse hook on Write/Edit to scan `.planning/` files for prompt injection patterns (advisory warning only, does not block)
- `gsd-read-before-edit.js`: Haiku-based PreToolUse prompt hook that checks whether target file was Read before Edit/Write (advisory only per design: "Blocking would prevent legitimate workflow operations")
- PreToolUse cache checker: Validates subscription/usage tracking (blocks on certain conditions)

**Disciplined Process Plugin:**
- `git commit` (Bash matcher): PreToolUse → trace-validator (Go binary) blocks commits without test traces in strict mode
- `git push` (Bash matcher): PreToolUse → pre-push-sync (prompt hook) warns before pushing
- Phase emission: SessionStart hook only (informational, no blocking)

**claude-hooks repository:**
- Package age: PreToolUse on `npm install|yarn add` — blocks packages >180 days old
- File constraints: PostToolUse on Edit|Write — validates function length (30 lines), file length (200 lines), line width (100 chars), nesting depth (4 levels) after the fact

**Claude Code Docs enforcement pattern:**
File protection example uses exit code 2:
```bash
if [[ "$FILE_PATH" == *".env"* ]]; then
  echo "Blocked: $FILE_PATH matches protected pattern" >&2
  exit 2  # blocks the action
fi
```

**Source:** [Automate workflows with hooks - Claude Code Docs](https://code.claude.com/docs/en/hooks-guide), [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done), [rand/disciplined-process-plugin](https://github.com/rand/disciplined-process-plugin), [decider/claude-hooks](https://github.com/decider/claude-hooks)

**Recommendation:** FORGE should use PreToolUse hooks exclusively for enforcement. PostToolUse is safe for audit logging, formatting, type-checking, and test validation — but only PreToolUse can block. Map required gate rules to specific tool + matcher combinations (e.g., `PreToolUse: Bash(npm install)`, `PreToolUse: Edit|Write`).

---

### Question 2: Do they restrict agent tool access via frontmatter?

**Finding:**
No enforcement plugin restricts agent tool access through frontmatter. The `tools:` field in agent YAML frontmatter is purely declarative — it tells Claude Code which tools the agent can use, but does **not enforce access control**. All enforcement happens via PreToolUse hooks, not via frontmatter restrictions.

GSD agents declare tools like any other plugin, and all access control is delegated to hooks:
- Agents can have `Read`, `Bash`, `Write` in frontmatter
- Hooks on PreToolUse intercept specific tool uses (e.g., `Bash(git commit *)`) to enforce workflow rules
- Frontmatter is transparent — agents cannot be "locked down" via tool lists

**Example from claude-code-docs:**
Frontmatter declares allowed tools:
```yaml
tools:
  - Read
  - Write
  - Bash
```
But then PreToolUse hook blocks specific Bash commands, Edit targets, etc. Frontmatter is not the enforcement layer.

**Source:** [Agent SDK hooks - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/hooks), agent definitions across GSD and Compound Engineering

**Recommendation:** FORGE agents should declare `tools:` based on what they legitimately need to use. Real enforcement (preventing misuse of those tools) belongs in PreToolUse hooks with matchers, not in frontmatter restrictions.

---

### Question 3: Do they use workflow guards or validation hooks?

**Finding:**
Workflow guards exist as **configuration-level filtering only** — not as standalone agents or middleware. The main guard pattern is:

1. **PreToolUse matchers** define which tool + arguments combinations are gated
2. **Prompt hooks or Go binaries** attached to PreToolUse evaluate semantic conditions
3. **Exit code 2** blocks if the condition is not met; agent re-plans with the feedback

GSD uses `STATE.md` as "memory across sessions" to maintain consistency, but this is not a guard — it is context reinjection.

**Disciplined Process Plugin's workflow guard pattern:**
```
SessionStart → phase-emitter → sets workflow phase context
PreToolUse(git commit) → trace-validator → checks for @trace markers
PreToolUse(git push) → pre-push-sync → syncs task tracker state
```
This is sequential validation through hooks, not a separate guard component.

**Claude Code Docs "Stop hook" pattern:**
Stop hooks can block Claude from finishing work if verification fails:
```json
{
  "hooks": {
    "Stop": [{
      "type": "prompt",
      "prompt": "Check if all tasks are complete. If not, respond with {\"ok\": false, \"reason\": \"what remains\"}."
    }]
  }
}
```
This prevents the agent from stopping until conditions are met.

**Source:** [Automate workflows with hooks - Claude Code Docs](https://code.claude.com/docs/en/hooks-guide), [rand/disciplined-process-plugin](https://github.com/rand/disciplined-process-plugin), GSD documentation

**Recommendation:** FORGE should not create a separate "workflow guard" agent. Instead, attach validation to specific lifecycle hooks: SessionStart for context injection, PreToolUse for action blocking, Stop for task completion checks. Use prompt-based or agent-based hooks (not just command hooks) for semantic validation.

---

### Question 4: Do they use MCP tools to enforce structure?

**Finding:**
MCP tools are not used for enforcement in GSD, Compound Engineering, or other open-source enforcement plugins. MCP tools provide **capabilities** (e.g., file access, web search, GitHub API) — they do not validate or gate workflow behavior.

Enforcement is entirely hook-based. The plugin manifest (`.mcp.json`) declares which MCP servers run, but the servers themselves are passive tool providers. No enforcement plugin implements an MCP "gate" tool that must be called to proceed.

GSD's MCP integration is described as "future: multi-engine routing" and focuses on API abstraction, not control flow.

**Compound Engineering documentation** mentions "MCP server support" but does not use MCP tools to enforce planning → work → review stages. Enforcement is through agents (Plan, Work, Review, Compound) and human review loops, not MCP tools.

**Claude Code's MCP tool hook:** A new feature allows MCP tools to fire `Elicitation` hooks (user input requests), but this is for asking the user — not for enforcing workflow. The hook can validate the response via `ElicitationResult`, but it is advisory, not blocking.

**Source:** GSD documentation, Compound Engineering plugin documentation, [Claude Code Docs - MCP tool hooks](https://code.claude.com/docs/en/hooks-guide)

**Recommendation:** FORGE's MCP server (if built) should provide **read/write access to pipeline state** (board, plan, context files) — not validation gates. Enforcement gates belong in PreToolUse hooks, not in MCP tools. If FORGE needs to ensure that a tool is called before proceeding (e.g., "must call `forge_read_board` before implementing"), use a Stop hook to check tool call history, not an MCP "guard" tool.

---

### Question 5: What other enforcement mechanisms do they use that FORGE doesn't?

**Finding:**

1. **Compiled binary validators (Disciplined Process Plugin):**
   - `trace-validator`: Go binary that parses git diffs and validates test trace markers
   - `coverage-check`: Checks test coverage deltas
   - `adr-validator`: Validates architectural decision records (ADRs)
   - Used in PreToolUse hooks for semantic validation without relying on LLM reasoning
   - Faster and more deterministic than prompt hooks

2. **Context reinjection on compaction (GSD + Claude Code Docs):**
   - SessionStart hook with `compact` matcher re-injects critical context after context window fills
   - Ensures enforcement rules and project conventions are never lost mid-session

3. **Configuration-level strictness levels (Disciplined Process Plugin):**
   - `strict` mode: blocks violations
   - `guided` mode: warns only
   - `minimal` mode: disables enforcement
   - Toggled via settings or environment variables, not hardcoded

4. **Semantic blocking with Haiku evaluation (GSD):**
   - Prompt hooks using Claude Haiku (lightweight) on PreToolUse
   - Evaluates conditions like "was this file read before editing?" or "does this change touch auth?"
   - Allows context-dependent enforcement without regex matching

5. **Multi-hook coordination (Disciplined Process Plugin):**
   - SessionStart to set phase context
   - PreToolUse (multiple matchers) to enforce phase-specific rules
   - Stop hook to verify task completion before exiting
   - Hooks share state via file system or env vars

6. **Audit logging via PostToolUse (claude-hooks, claude-code-showcase):**
   - Logs every tool use to files for compliance
   - Tracks who did what and when
   - PostToolUse is safe for this (no need to block)

7. **File watcher hooks (CwdChanged, FileChanged):**
   - Claude Code's FileChanged hook reloads environment on `.env` changes
   - CwdChanged hook re-runs `direnv export` when directory changes
   - Keeps runtime context synchronized with external state

**Source:** [rand/disciplined-process-plugin](https://github.com/rand/disciplined-process-plugin), [Automate workflows with hooks - Claude Code Docs](https://code.claude.com/docs/en/hooks-guide), [decider/claude-hooks](https://github.com/decider/claude-hooks), [GSD documentation](https://github.com/gsd-build/get-shit-done)

**Recommendation:**

For FORGE enforcement, prioritize in this order:
1. **PreToolUse blocking** (ReadAgent, EditAgent, Bash on critical commands) — CRITICAL
2. **Prompt-based validation** (Haiku evaluation of semantic conditions) — IMPORTANT
3. **Context reinjection on compaction** (SessionStart + compact matcher) — IMPORTANT
4. **Audit logging via PostToolUse** (log all tool use to `.pipeline/run-active.json`) — NICE-TO-HAVE
5. **Compiled validators** (only if enforcement is complex enough to justify build step) — DEFER
6. **File watcher hooks** (CwdChanged/FileChanged) — DEFER

---

## Summary

The enforcement pattern across GSD, Compound Engineering, and open-source plugins is **hook-driven, not tool-driven or frontmatter-driven**. Specifically:

- **PreToolUse blocks actions with exit code 2** — the only way to prevent bad behavior
- **Exit code 2 triggers agent re-planning** — the agent sees stderr as feedback and adjusts
- **Prompt hooks evaluate semantic conditions** — Haiku can decide if a change is risky without regex
- **PostToolUse only audits** — never blocks
- **MCP tools are passive** — they provide capabilities, not gates
- **Frontmatter declares capabilities, hooks enforce rules** — they are complementary, not overlapping

FORGE should implement PreToolUse hooks on:
- `Bash(git commit)` — validate commit messages, prevent commits during active work
- `Bash(npm/pip install)` — enforce dependency review
- `Edit|Write` — validate edit patterns (read-before-edit, protected files)
- `Stop` — verify task requirements before declaring done

All other validation (style, coverage, linting) belongs in PostToolUse and should not block execution.
