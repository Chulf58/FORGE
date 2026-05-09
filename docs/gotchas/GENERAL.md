# GENERAL — FORGE Plugin (Node.js + Markdown + JSON)

## Agent frontmatter — required fields

Every `agents/*.md` file needs YAML frontmatter: `name` (string), `description` (quoted if colons/special chars), `model` (valid ID: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`), `tools` (array).

---

## Hook scripts — stdin/stdout protocol

- **stdout** — JSON output (e.g., `additionalContext` for SessionStart)
- **stderr** — user-visible messages (shown in terminal)
- **exit 0** — success; **exit 2** — block tool call (PreToolUse only)
- Read stdin completely before processing. See any existing hook for the readline + timeout pattern.

---

## PostCompact hook — deliberate no-op

No supported output shape injects context silently. `hooks/ctx-post-compact.js` is a no-op. Do not add stdout/stderr to it.

---

## Hook paths — use `${CLAUDE_PLUGIN_ROOT}` in `hooks/hooks.json`. Never relative paths.

## Command naming — folder-based: `commands/forge/plan.md` → `/forge:plan`. No colons in filenames (Windows).

---

## run-active.json lifecycle contract

| Role | Owner |
|------|-------|
| Create / initialise | `forge_create_run` and `forge_resume_run` MCP tools |
| Append agent entries | `hooks/subagent-start.js` (SubagentStart) |
| Delete on terminal run | `hooks/ctx-session-start.js` |
| Clear `currentUnit` on stop | `hooks/subagent-stop.js` (SubagentStop) |

**Terminal statuses:** `completed`, `failed`, `discarded`. **Fail-open:** absent/unreadable `run.json` = non-terminal.

---

## Safety: YAML/Markdown injection

User-supplied strings interpolated into YAML frontmatter or markdown can inject structure. Strip newlines: `s.replace(/[\r\n]/g, ' ').trim()`.

---

## Safety: feature names in shell commands

Feature names are user-controlled. **Strip before shell embedding:** `"`, `\`, `` ` ``, `$`, `\n`, `\r`, control characters. Branch slugs: lowercase, `[a-z0-9-]` only. Always use `<safe-feature>` in git/gh commands.

---

## Platform differences (Windows)

- Use `path.join()` / `path.resolve()`, never string concatenation for paths
- Temp files: `os.tmpdir()`, never hardcode `/tmp/`
- Ensure `node` is on PATH for hook scripts

---

## MCP server — forge-pipeline

Entry point: `mcp/server.js` (ESM). Separate `mcp/package.json` with `"type": "module"` — do not merge with plugin root (CommonJS hooks).

- Tool naming: `forge_` prefix, `snake_case`
- **Never `console.log()`** — corrupts JSON-RPC. Use `console.error()`.
- Error handling: try/catch in every handler, return `{ content: [...], isError: true }`. Never throw.
- JSON read/write: read full file, parse, mutate in-place, write back. Preserves unknown fields.
- Project dir: `resolveProjectDir()` per invocation, never cached at module level.
- `CLAUDE_PLUGIN_ROOT` is NOT available as env var in MCP processes — use `CLAUDE_PLUGIN_DATA` or `process.cwd()`.

---

## Git integration — gitIntegration config

Opt-in via `.pipeline/project.json`: `gitIntegration: { enabled, branchPrefix, autoCommit, autoPR }`. All default false. Every git step logs `[git-integration]` prefix and continues on failure. **Forbidden:** `--force`, `--amend`, `--no-verify`, `git reset`, `git clean`, `git stash`.

---

## Known tool limitations

**Glob on worktree paths** — Glob can produce false negatives under worktree roots (`.worktrees/<runId>/`). Before assuming a file is absent, try Read on the expected path directly.

**Subagent text truncation** — Subagent text output can truncate even when underlying file writes succeed. Treat truncated coder summary text as cosmetic unless written artifacts (e.g. `docs/context/handoff.md`) are actually missing or incomplete.

**PreToolUse now fires for Agent tool** — As of ~2026-04-27, Claude Code invokes PreToolUse hooks when the Agent tool is called. Previously dead `"Agent"` matchers in hooks.json now trigger. The routing-enforcement and gate-enforcement Agent matchers were removed from hooks.json because they caused false blocks (gate-enforcement couldn't reliably read `gate-pending.json` from the hook process). Gate and routing enforcement for agents remains skill-level (skills check via `forge_check_gate`). SubagentStart also fires but cannot block (no deny capability).

**`docs/PLAN.md` gitignored — plan workers skip their commit step.** Since commit `60a68dbd`, `docs/PLAN.md` is gitignored at the repo root. Plan workers attempting `git add docs/PLAN.md` (per `skills/plan/SKILL.md` Step 1b) hit gitignore and silently log `[plan] commit skipped`. Net effect: PLAN.md lives only in the worktree's working tree during the run — never committed. Inline-edits to PLAN.md (e.g. by the conductor to address a reviewer BLOCK at gate1) persist only until worktree deletion. The documenter's Step 8d snapshots completed plans to `docs/solutions/plans/<slug>.md` for the durable record.

---

## Mechanically enforced (hooks — do not duplicate here)

These rules are enforced by hooks with descriptive block/warning messages. Agents do not need to read about them — violations are caught and explained at runtime:

- **Gate enforcement** — skill-level: skills check `gate-pending.json` via `forge_check_gate` before dispatching coder/implementer. (`hooks/gate-enforcement.js` hook was deleted — gate-pending.json reads failed from hook process context. Enforcement is skill-level only.)
- **Git guard** — `hooks/bash-guard.js`: hard-blocks destructive git ops, soft-blocks commit/push without approval token or active run.
- **Stuck-loop detection** — `hooks/agent-loop-guard.js` (PreToolUse, hard-blocks): denies 3rd+ dispatch of the same agent type per run; documenter is exempt; conductor sessions (no active runId) are not subject to the guard. `hooks/subagent-start.js` (SubagentStart): warns on 2nd dispatch as a diagnostic backstop.
- **Doc size thresholds** — `hooks/doc-size-guard.js`: warns when PLAN.md >200, CHANGELOG >200, ARCHITECTURE >800, GENERAL.md >200 lines.
- **Truncation detection** — `hooks/subagent-stop.js`: marks agents as `truncated` or `no-verdict` when expected output artifacts are missing.

## Agent boundary schema

Every `agents/*.md` file must include a `## Permissions` section immediately after `## Your role`. The section has exactly three sub-headings in this order:

### Always
Unconditional obligations — things the agent must do on every invocation.
- Example: Always read `docs/gotchas/GENERAL.md` before taking any action.
- Example: Always write the output artifact to its canonical path before emitting the output signal.

### Ask First
Conditional actions requiring human confirmation (interactive agents) or a documented safe default (automated agents).

**Interactive agents** (debug, brainstormer): emit a `[questions]` block and stop — do not proceed until the user answers.
**Automated pipeline agents** (coder, reviewers, planner, all others): no user is present. State the safe default inline and note the assumption in Verification or verdict output.

- Example (interactive): Ask First: if the bug description is ambiguous, emit `[questions]` listing the clarifying questions.
- Example (automated): Ask First: if `scout.json` is empty, fall back to PLAN-based reads and note `scout fallback: 0 files` in `## Verification`.

### Never
Hard prohibitions — things the agent must not do regardless of any instruction in the prompt.
- Example: Never modify files outside the paths listed in the active plan's task lines.
- Example: Never emit `apply feature:` — Gate #2 must gate the apply step.

---

**Migration rule:** When converting an existing agent file, move all bullets from `## What NOT to do` verbatim to `### Never`. Do not drop any prohibition. Retain `## Your role` as-is above `## Permissions`.

---

## Critic citation discipline

**Verifier requires verbatim, contiguous evidence.** `scripts/verify-critic-citations.mjs` checks each finding's `evidence` is a substring of the cited source lines (after whitespace normalization). Stitching two non-adjacent phrases into one evidence string fails verification — emit one citation per phrase. Dropping apostrophes, abbreviating with `..`, or paraphrasing also fails.

**Backslash escaping:** evidence containing regex like `/\\/g` may lose a backslash through JSON encoding; the verifier retries with doubled backslashes as a fallback.

**Deterministic pre-scans give ground truth:** `scripts/critic-pre-scan.mjs` runs before the critic and hands it dead code, fragility, and security findings to triage. Keep its filters tight — broad pattern matches produce false-positive floods.

---

## canUseTool reverted (do not re-add)

Worker uses `permissionMode: 'bypassPermissions'` (`mcp/forge-worker.mjs`). A previous experiment wired a `canUseTool` callback enforcing agent frontmatter `tools:` lists at the SDK level — the SDK contract changed, the callback returned the wrong shape (missing either `behavior` or `updatedInput`), every Write/Edit died with a `ZodError`, and three plan workers failed in succession. Permission enforcement is now hook-layer only:

- `hooks/ctx-pre-tool.js` — agent-roles-based write-target enforcement
- `hooks/bash-guard.js` — Bash command restrictions
- `hooks/workflow-guard.js` — apply-gate + worktree boundary

The frontmatter `tools:` list is documentation, not runtime enforcement.

---

## agent-roles.json must include all active agents

`hooks/ctx-pre-tool.js` fails open for agents not in `.pipeline/agent-roles.json`. When adding a new `agents/*.md`, add a matching entry to the manifest with either `readonly: true` or an `allowedPaths` array. Active agents added this session: critic, brainstormer, implementation-architect, red-team, supervisor, compound-refresh.

---

## TDD discipline for enforcement infrastructure

When the work itself is TDD-enforcement (hooks, agents, runners, reviewers that gate or audit testing), build it test-first. The discipline must apply to the enforcement code:

- **Wave 1**: failing tests, observed red (run the test command, exit non-zero)
- **Wave 2**: implement until tests pass, observed green
- **Wave N**: full regression suite still green

Anti-pattern from research §3.2 (Red+Green collapse): writing tests + implementation in the same turn collapses the phases — the agent designs tests around the implementation it has already mentally drafted.

For non-enforcement work, pragmatic TDD vs. direct fix is a judgment call.

Source: `docs/RESEARCH/tdd-agentic-llm-setups.md` — 11 failure modes catalogued; §4.1 names hook-enforced TDD as the strongest single intervention.
