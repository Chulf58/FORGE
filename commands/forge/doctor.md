Run FORGE installation diagnostics. Execute ALL checks below, then print a single summary table.

## Checks

Run these in order. For each, record PASS or FAIL + fix message.

### 1. Node.js in PATH
Run `node --version` via Bash (timeout 5000). PASS if exit 0. FAIL: "Install Node.js 18+ from https://nodejs.org and restart your terminal."

### 2. Plugin root resolved
Use Glob for `.claude-plugin/plugin.json` (search from the repo root upward). PASS if found. FAIL: "Plugin not loaded correctly. Reinstall via: claude plugin add <path>"

### 3. MCP server entry point exists
Use Glob for `mcp/server.js` under the plugin root. PASS if found. FAIL: "Plugin files are incomplete. Reinstall the plugin."

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
