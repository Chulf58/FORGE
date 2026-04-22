---
name: forge:init
description: "Initialize a new FORGE project. Use when: user wants to set up FORGE in a new project, or says 'init', 'setup', 'initialize'."
argument-hint: "[optional: project name]"
allowed-tools: "Read Write Glob Bash"
---

## STEP 0 — Resolve FORGE plugin root

`CLAUDE_PLUGIN_ROOT` is set for hook subprocesses but NOT for general Bash tool calls. Discover the plugin path reliably:

1. Try Bash: `echo "$CLAUDE_PLUGIN_ROOT"` — if non-empty, use that path. Done.
2. If empty, search for the plugin manifest: use Glob with pattern `**/.claude-plugin/plugin.json` under the user's home directory (e.g. `C:\Users\<user>` on Windows, `~` on macOS/Linux). Read each match and find the one containing `"name": "forge"`. The plugin root is the parent directory of the `.claude-plugin/` folder.
3. If still not found, print: `[init] ERROR: Cannot find FORGE plugin directory. Steps 1e, 1f, and 4 will be skipped. Ensure the FORGE plugin is installed, or set CLAUDE_PLUGIN_ROOT in your launcher script.`

Store the resolved path as `PLUGIN_ROOT` for use by all subsequent steps. When later steps reference `PLUGIN_ROOT`, use this resolved value.

## STEP 1 — Clean stale legacy artifacts (ALWAYS run this step, even if project is already initialized)

### 1a — Stale commands

Check if `.claude/commands/forge/` exists (use Bash: `test -d .claude/commands/forge && echo exists`).

If it exists:
1. Remove it recursively: `rm -rf .claude/commands/forge`
2. Check if `.claude/commands/` is now empty: `[ -z "$(ls -A .claude/commands 2>/dev/null)" ]`
3. If empty, remove it too: `rmdir .claude/commands`
4. Print: "Removed stale legacy command files from .claude/commands/forge/."

If it does not exist: skip silently.

### 1b — Stale hooks

The FORGE plugin now provides all hooks centrally via `${CLAUDE_PLUGIN_ROOT}/hooks/`. Project-local copies under `.claude/hooks/` are pre-plugin artifacts that drift out of date.

Check if `.claude/hooks/` exists. If it does, remove only these known FORGE-scaffolded files (use Bash for each):
- `ctx-post-tool.js`
- `ctx-pre-tool.js`
- `ctx-session-start.js`
- `workflow-guard.js`
- `forge-banner.js`

For each: `rm .claude/hooks/<file> 2>/dev/null`

After removing known files, check if `.claude/hooks/` is now empty: `[ -z "$(ls -A .claude/hooks 2>/dev/null)" ]`
If empty, remove it too: `rmdir .claude/hooks`

If any files were removed, print: "Removed stale legacy hook files from .claude/hooks/. Plugin hooks are now used."

If `.claude/hooks/` does not exist: skip silently.

### 1c — Ensure .gitignore covers FORGE local state

FORGE creates `.pipeline/` and `.worktrees/` which must not be committed. The generated launcher (`forge.cmd` / `forge.sh`) contains absolute paths and must also be ignored.

1. Use Read to check if `.gitignore` exists and read its contents. If Read returns "file does not exist", treat contents as empty.
2. Check if these entries are already present (one per line, exact match): `.pipeline/`, `.worktrees/`, `forge.cmd`, `forge.sh`.
3. If any entries are missing, use Write (if creating new) or Edit (if appending to existing) to add the missing entries, each on its own line.

Do NOT use Bash for this step — bash-guard blocks grep and echo-to-file.

### 1d — Warn if FORGE state is already tracked in git

If the project is a git repo, check whether `.pipeline/` or `.worktrees/` have tracked files.

1. Use Bash: `git rev-parse --git-dir` — if this exits non-zero, the project is not a git repo; skip silently.
2. If it IS a git repo, run two separate Bash commands: `git ls-files .pipeline` and `git ls-files .worktrees`.
3. For each that returns non-empty output, print a warning as text output (NOT via Bash echo):

```
WARNING: <dir>/ has files tracked in git.
This can cause stale state in worktree checkouts and noisy git diffs.
To fix, run:
  git rm -r --cached <dir>/
  git commit -m "chore: untrack FORGE local state (<dir>/)"
```

Do NOT run `git rm` automatically — only print the commands for the user.
Do NOT combine git commands with echo or grep in Bash — bash-guard blocks those.

### 1e — Register project-level statusLine (non-destructive)

If `PLUGIN_ROOT` was not resolved in Step 0, skip this step with: `[statusLine] Plugin root unknown — skipping.`

Claude Code's `statusLine` shows a persistent bar at the bottom of the terminal. FORGE ships a status line script at `PLUGIN_ROOT/bin/forge-status.js`.

On Windows, bare `node` is not reliably on PATH for statusLine invocations, so FORGE writes a small `.claude/forge-status.cmd` wrapper that embeds the absolute Node path. Use Bash to get the node path: `Bash: node -e "console.log(process.execPath)"` — store the result as `NODE_EXE`.

**1e-i — Write the wrapper file.** Use Write to create `.claude/forge-status.cmd` with this content (substitute `NODE_EXE` and `PLUGIN_ROOT` with the resolved values):

```
@echo off
"<NODE_EXE>" "<PLUGIN_ROOT>/bin/forge-status.js" %*
```

Use `\r\n` line endings (Windows). Create the `.claude/` directory via `Bash: mkdir -p .claude` if needed.

**1e-ii — Update settings.json.** Use Read to check if `.claude/settings.json` exists.

- If it exists: parse the JSON. If it has a `statusLine` field that does NOT contain `forge-status` in its command, print `[statusLine] Already configured (non-FORGE) — not replacing.` and skip. Otherwise, update or add the `statusLine` field using Edit.
- If it does not exist: use Write to create it.

The `statusLine` value must be:
```json
{
  "statusLine": {
    "type": "command",
    "command": ".claude/forge-status.cmd"
  }
}
```

Preserve all other existing fields in settings.json. The user must restart for the status line to appear.

### 1f — Seed project-local forge-config.json (fallback when CLAUDE_PLUGIN_DATA is unset)

If `PLUGIN_ROOT` was not resolved in Step 0, skip this step with: `[forge-config] Plugin root unknown — skipping.`

`mcp/lib/config-store.js` reads model-routing config from `${CLAUDE_PLUGIN_DATA}/forge-config.json` first, then falls back to `.pipeline/forge-config.json`. When `CLAUDE_PLUGIN_DATA` is not set, the project-local fallback must exist or config-dependent MCP tools fail.

1. Use Read to check if `.pipeline/forge-config.json` already exists. If it does, print `[forge-config] .pipeline/forge-config.json already exists — preserving.` and skip.
2. Use Read to read `PLUGIN_ROOT/forge-config.default.json`. If it does not exist, print `[forge-config] Default template not found — skipping.` and skip.
3. Use Write to create `.pipeline/forge-config.json` with the contents read from the default template. Create `.pipeline/` via `Bash: mkdir -p .pipeline` if needed.
4. Print: `[forge-config] Seeded .pipeline/forge-config.json from default template.`

Never overwrite — user edits to the project config must be preserved across re-runs of `/forge:init`.

### 1g — Generate project launcher (forge.cmd / forge.sh)

If `PLUGIN_ROOT` was not resolved in Step 0, skip this step with: `[launcher] Plugin root unknown — skipping.`

The launcher opens Claude Code with the FORGE Observer TUI in a split-pane layout — Claude on the left, observer on the right. It is regenerated on every `/forge:init` run to pick up path changes.

**1g-i — Resolve paths.** `NODE_EXE` was already resolved in Step 1e. Additionally resolve:

1. Claude CLI path — Bash: `node -e "const{execSync}=require('child_process');console.log(execSync(process.platform==='win32'?'where claude':'which claude',{encoding:'utf8'}).trim().split(/\\r?\\n/)[0])"`
   Store as `CLAUDE_EXE`. If this fails, print `[launcher] Claude CLI not found on PATH — skipping.` and skip.
2. Platform — Bash: `node -e "console.log(process.platform)"`
   Store as `PLATFORM`.

**1g-ii — Write the launcher.**

**If PLATFORM is `win32`** — write `forge.cmd` in the project root:

```
@echo off
set "PROJECT=%~dp0."
set "NODE=<NODE_EXE>"
set "CLAUDE=<CLAUDE_EXE>"
for /f "delims=" %%i in ('where wt 2^>nul') do set "WT=%%i"
if not defined WT (
  echo Windows Terminal not found. Install it from the Microsoft Store.
  echo Falling back to Claude only...
  "%CLAUDE%"
  exit /b
)
"%WT%" -d "%PROJECT%" cmd /k "%CLAUDE%" ; sp -V -s 0.35 -d "%PROJECT%" cmd /k call "%NODE%" "<PLUGIN_ROOT>/scripts/forge-observer.mjs"
```

Substitute `<NODE_EXE>`, `<CLAUDE_EXE>`, and `<PLUGIN_ROOT>` with the resolved values. Use `\r\n` line endings.

**If PLATFORM is NOT `win32`** (macOS, Linux, Azure Cloud Shell) — write `forge.sh` in the project root:

```bash
#!/usr/bin/env bash
set -e
PROJECT="$(cd "$(dirname "$0")" && pwd)"
NODE="<NODE_EXE>"
CLAUDE="<CLAUDE_EXE>"
OBSERVER="<PLUGIN_ROOT>/scripts/forge-observer.mjs"

if command -v tmux &>/dev/null; then
  tmux new-session -d -s forge -c "$PROJECT" "$CLAUDE" \; \
    split-window -h -p 35 -c "$PROJECT" "$NODE" "$OBSERVER" \; \
    select-pane -t 0 \; \
    attach-session -t forge
else
  echo "tmux not found. Install it for split-pane layout."
  echo "Falling back to Claude only..."
  exec "$CLAUDE"
fi
```

Substitute `<NODE_EXE>`, `<CLAUDE_EXE>`, and `<PLUGIN_ROOT>` with the resolved values. Use `\n` line endings.

After writing, make the script executable: `Bash: chmod +x forge.sh`

**1g-iii — Print result.**

Print: `[launcher] Generated <filename> — run it to open Claude + Observer side by side.`

## STEP 2 — Check if already initialized

Check if `.pipeline/project.json` exists. If it does, print "FORGE project already initialized." and stop.

## STEP 3 — Initialize project

Ask: project name, tech stack, description.

Create `.pipeline/` with:
- `project.json` (name, description, techStacks, pipelineMode: "LEAN")
- `board.json` (`{"todos":[]}`)
- `modules.json` (`[]`)

Create `docs/` directory (via `Bash: mkdir -p docs`). Do NOT create `PLAN.md` here — it is copied from the scaffold in Step 4 (with format hints). If Step 4 is skipped (no plugin root), create a minimal `docs/PLAN.md` with content: `## Active Plan\n`.

## STEP 4 — Apply scaffold (based on tech stack)

Resolve the scaffold directory from the user's tech stack answer:

| Tech stack keywords | Scaffold |
|---|---|
| power automate, power platform, flow | `power-automate` |
| instructional, documentation, non-code, training, handover, checklist, process, salesforce, servicenow, crm, erp, admin, platform admin, consulting | `instructional` |
| anything else (code, node, python, web, etc.) | `code` |

If `PLUGIN_ROOT` was not resolved in Step 0:
1. Print: `[scaffold] WARNING: Plugin root unknown — scaffold files (including CLAUDE.md) were NOT copied.`
2. Print: `To fix: set CLAUDE_PLUGIN_ROOT in your launcher script, or ensure the FORGE plugin is installed, then re-run /forge:init.`
3. Do NOT skip silently — the missing CLAUDE.md will break pipeline routing.
4. Stop here.

The scaffold root is `PLUGIN_ROOT/scaffolds/<scaffold-name>/`.

Copy these files from the scaffold into the project. For each file, use Read to read the source from the scaffold directory, then Write to create it in the project. **Never overwrite files that already exist in the project** — check with Read first.

1. `CLAUDE.md` → project root `CLAUDE.md`
2. `docs/PLAN.md` → project `docs/PLAN.md` (has format hints for the planner)
3. `docs/gotchas/GENERAL.md` → project `docs/gotchas/GENERAL.md`
4. `docs/gotchas/SKILLS.md` → project `docs/gotchas/SKILLS.md` (if exists in scaffold)
5. `.claude/agents/documenter.md` → project `.claude/agents/documenter.md` (if exists in scaffold)
6. `.claude/agents/tool-call-auditor.md` → project `.claude/agents/tool-call-auditor.md` (if exists in scaffold)
7. `.claude/agents/nyquist-auditor.md` → project `.claude/agents/nyquist-auditor.md` (if exists in scaffold)
8. `.claude/agents/skills-generator.md` → project `.claude/agents/skills-generator.md` (if exists in scaffold)
9. `.claude/agents/integrity-checker.md` → project `.claude/agents/integrity-checker.md` (if exists in scaffold)

For each file in the list above:
1. Use Read to check if the destination already exists in the project. If it does, skip it.
2. Use Read to read the source file from `PLUGIN_ROOT/scaffolds/<scaffold-name>/<file>`. If it does not exist in the scaffold, skip it.
3. Create parent directories if needed via `Bash: mkdir -p <parent>`.
4. Use Write to create the file in the project with the contents from the scaffold.
5. Print: `[scaffold] Copied <file> from <scaffold-name> scaffold.`

**Additional glob-based copy** — after the list above, use Glob to find all `*.md` files under `PLUGIN_ROOT/scaffolds/<scaffold-name>/docs/gotchas/skills/`. For each file found, copy it to the same relative path in the project (e.g. `docs/gotchas/skills/typescript-strict.md`). Same rules: never overwrite, Read + Write only.

Do NOT use Bash for any copy — use Read + Write to avoid `CLAUDE_PLUGIN_ROOT` env var dependency.

Print "FORGE project initialized."

$ARGUMENTS
