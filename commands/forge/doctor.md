Run FORGE installation diagnostics. Execute ALL checks below, then print a single summary table.

## Checks

Run these in order. For each, record PASS or FAIL + fix message.

### 1. Node.js in PATH
Run `node --version` via Bash (timeout 5000). PASS if exit 0. FAIL: "Install Node.js 18+ from https://nodejs.org and restart your terminal."

### 2. Plugin root resolved
Check if `CLAUDE_PLUGIN_ROOT` env var is set (read from Bash: `echo $CLAUDE_PLUGIN_ROOT`). PASS if non-empty. FAIL: "Plugin not loaded correctly. Reinstall via: claude plugin add <path>"

### 3. MCP server launcher exists
Use Glob for `bin/forge-mcp-server.cmd` under the plugin root. PASS if found. FAIL: "Restart Claude Code — the SessionStart hook generates this file."

### 4. MCP dependencies installed
Use Glob for `mcp/node_modules/@modelcontextprotocol` under the plugin root. PASS if found. FAIL: "Restart Claude Code — the SessionStart hook runs npm install."

### 5. MCP server responding
Call `forge_dashboard_state` MCP tool. PASS if it returns data without error. FAIL: "MCP server not running. Check Claude Code logs for forge-pipeline errors, or restart Claude Code."

### 6. Project initialized
Use Read to check `.pipeline/project.json` in the current working directory. PASS if readable and valid JSON. FAIL: "Run /forge:init to set up this project for FORGE."

## Output format

Print exactly this table (replace status/fix per check):

```
FORGE Doctor
═══════════════════════════════════════════════════════════════
 #  Check                        Status   Fix
───────────────────────────────────────────────────────────────
 1  Node.js in PATH              ✓ PASS
 2  Plugin root resolved         ✓ PASS
 3  MCP server launcher          ✓ PASS
 4  MCP dependencies             ✓ PASS
 5  MCP server responding        ✓ PASS
 6  Project initialized          ✓ PASS
═══════════════════════════════════════════════════════════════
 Result: All checks passed — FORGE is ready.
```

For failures, replace `✓ PASS` with `✗ FAIL` and add the fix message in the Fix column. The final line should read `Result: N issue(s) found — see Fix column.` if any check failed.

Do not explain the checks. Do not add commentary. Just run them and print the table.
