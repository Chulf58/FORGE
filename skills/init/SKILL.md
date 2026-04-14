---
name: forge:init
description: "Initialize a new FORGE project. Use when: user wants to set up FORGE in a new project, or says 'init', 'setup', 'initialize'."
argument-hint: "[optional: project name]"
allowed-tools: "Read Write Glob Bash"
---

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

FORGE creates `.pipeline/` and `.worktrees/` which must not be committed. Ensure `.gitignore` includes them. Use Bash:

```
for entry in ".pipeline/" ".worktrees/"; do
  grep -qxF "$entry" .gitignore 2>/dev/null || echo "$entry" >> .gitignore
done
```

This creates `.gitignore` if absent, or appends missing entries if it exists. It does NOT duplicate lines already present.

### 1d — Warn if FORGE state is already tracked in git

If the project is a git repo, check whether `.pipeline/` or `.worktrees/` have tracked files. Use Bash:

```
if git rev-parse --git-dir >/dev/null 2>&1; then
  for dir in ".pipeline" ".worktrees"; do
    if git ls-files "$dir" 2>/dev/null | grep -q .; then
      echo ""
      echo "WARNING: $dir/ has files tracked in git."
      echo "This can cause stale state in worktree checkouts and noisy git diffs."
      echo "To fix, run:"
      echo "  git rm -r --cached $dir/"
      echo "  git commit -m \"chore: untrack FORGE local state ($dir/)\""
      echo ""
    fi
  done
fi
```

If the project is not a git repo, skip silently.
Do NOT run `git rm` automatically — only print the commands for the user.

### 1e — Register project-level statusLine (non-destructive)

Claude Code's native `statusLine` feature shows a persistent bar at the bottom of the terminal — ideal for project/session identity. FORGE ships a status line script at `${CLAUDE_PLUGIN_ROOT}/bin/forge-status.js`.

Register it in the project's `.claude/settings.json` only if no `statusLine` is already configured. Bare `node` is not reliably on PATH for statusLine invocations on Windows, so FORGE generates a small `.claude/forge-status.cmd` wrapper that embeds the absolute Node path from the current runtime (`process.execPath`), then points the statusLine config at the wrapper. This avoids the "node is not recognized" failure and the cmd.exe double-quoted-token parsing bug.

Use Bash + node for safe JSON handling:

```
mkdir -p .claude
node -e '
const fs = require("fs");
const path = require("path");
const p = ".claude/settings.json";
const wrapperPath = ".claude/forge-status.cmd";

// 1) Always (re)generate the wrapper — it embeds the current node.exe path
//    and is tiny/idempotent. This removes the bare-node PATH dependency.
const pluginRootVar = process.env.CLAUDE_PLUGIN_ROOT;
if (!pluginRootVar) {
  console.log("[statusLine] CLAUDE_PLUGIN_ROOT not set — cannot generate wrapper; skipping.");
  process.exit(0);
}
const nodeExe = process.execPath;
const scriptPath = path.join(pluginRootVar, "bin", "forge-status.js");
const wrapperContent = "@echo off\r\n\"" + nodeExe + "\" \"" + scriptPath + "\" %*\r\n";
fs.writeFileSync(wrapperPath, wrapperContent);
console.log("[statusLine] Wrote wrapper: " + wrapperPath);

// 2) Update settings.json to point at the wrapper (conservative on existing).
let s;
let fileExisted = false;
try {
  const raw = fs.readFileSync(p, "utf8");
  fileExisted = true;
  try {
    s = JSON.parse(raw);
  } catch (_) {
    console.log("[statusLine] WARNING: .claude/settings.json exists but is not valid JSON.");
    console.log("[statusLine] FORGE did NOT modify the file. Fix the JSON and re-run /forge:init.");
    process.exit(0);
  }
} catch (_) {
  s = {};
}

// Migration: if an existing statusLine command uses the old bare-node form
// (contains `node "${CLAUDE_PLUGIN_ROOT}/bin/forge-status.js"` or absolute
// node.exe + script with double quotes), upgrade it to the wrapper.
const oldFormPatterns = [
  /node\s+"\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/forge-status\.js"/,
  /bin\/forge-status\.js/
];
const isOldForgeStatus = s.statusLine
  && typeof s.statusLine === "object"
  && typeof s.statusLine.command === "string"
  && oldFormPatterns.some(re => re.test(s.statusLine.command))
  && !s.statusLine.command.includes("forge-status.cmd");

if (s.statusLine && !isOldForgeStatus) {
  console.log("[statusLine] Already configured (non-FORGE) — FORGE did not replace it.");
  process.exit(0);
}

s.statusLine = {
  type: "command",
  command: ".claude/forge-status.cmd"
};
fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
if (isOldForgeStatus) {
  console.log("[statusLine] Upgraded old FORGE statusLine form to wrapper.");
} else {
  console.log(fileExisted
    ? "[statusLine] Added FORGE status line to existing .claude/settings.json"
    : "[statusLine] Created .claude/settings.json with FORGE status line"
  );
}
'
```

This creates `.claude/settings.json` if absent, preserves all existing fields when valid, refuses to modify when the file is invalid JSON, and only adds `statusLine` when none exists. The user must restart the Claude Code session for the status line to appear.

### 1f — Seed project-local forge-config.json (fallback when CLAUDE_PLUGIN_DATA is unset)

`mcp/lib/config-store.js` reads model-routing config from `${CLAUDE_PLUGIN_DATA}/forge-config.json` first, then falls back to `.pipeline/forge-config.json`. The `hooks/mcp-deps-install.js` bootstrap handles the plugin-data path only when `CLAUDE_PLUGIN_DATA` is set; when it is not, the project-local fallback must exist or config-dependent MCP tools (model recommendation, external provider calls, usage tracking) fail with a "forge-config.json not found" error.

Copy `${CLAUDE_PLUGIN_ROOT}/forge-config.default.json` to `.pipeline/forge-config.json` only when the destination does not already exist. Never overwrite — user edits to the project config must be preserved across re-runs of `/forge:init`.

Use Bash:

```
if [ -z "$CLAUDE_PLUGIN_ROOT" ]; then
  echo "[forge-config] CLAUDE_PLUGIN_ROOT not set — skipping project-local config seed."
elif [ -f ".pipeline/forge-config.json" ]; then
  echo "[forge-config] .pipeline/forge-config.json already exists — preserving."
elif [ ! -f "$CLAUDE_PLUGIN_ROOT/forge-config.default.json" ]; then
  echo "[forge-config] Default template not found at \$CLAUDE_PLUGIN_ROOT/forge-config.default.json — skipping."
else
  mkdir -p .pipeline
  cp "$CLAUDE_PLUGIN_ROOT/forge-config.default.json" .pipeline/forge-config.json
  echo "[forge-config] Seeded .pipeline/forge-config.json from default template."
fi
```

This step is idempotent: running it repeatedly is safe. It never touches an existing config file, creates `.pipeline/` on demand, and degrades cleanly (no error, just a skip message) when either the plugin root or the default template is unavailable.

## STEP 2 — Check if already initialized

Check if `.pipeline/project.json` exists. If it does, print "FORGE project already initialized." and stop.

## STEP 3 — Initialize project

Ask: project name, tech stack, description.

Create `.pipeline/` with:
- `project.json` (name, description, techStacks, pipelineMode: "LEAN")
- `board.json` (`{"todos":[]}`)
- `modules.json` (`[]`)

Create `docs/` with:
- `PLAN.md` (empty active plan template)
- `gotchas/GENERAL.md` (stack-specific conventions placeholder)

Print "FORGE project initialized."

$ARGUMENTS
