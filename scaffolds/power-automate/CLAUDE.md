# CLAUDE.md — Power Automate project (FORGE scaffold)

> Project-local agent behaviour guidance for scaffolded Power Automate projects. This file currently covers tool choice only — pipeline rules, gate system, and other scaffold conventions live in the FORGE plugin itself.

---

## Approach-first protocol (MANDATORY)

Before ANY direct file edit, present the approach to the user — what will change, which files, why — and wait for explicit approval. Only user words like "yes", "go", "do it", "approved" count. Narrating intent ("let me fix", "I'll update") is NOT self-authorization. This applies even for obvious one-line fixes, even in auto mode. Workers are exempt (they operate autonomously inside pipelines).

---

## Tool efficiency

For every operation, pick the cheapest dedicated tool that does the job. The table below is the decision reference. The FORGE plugin's `bash-guard` hook enforces a subset of this as a backstop — the table is the primary guidance and should make the backstop rarely fire.

| Need to… | Use | Common mistake |
|---|---|---|
| Read a file | `Read` | `cat` / `head` / `tail` in Bash (blocked by bash-guard); also `node -e 'require("./foo.json")…'` for JSON (slow Node startup, raw stdout, no formatting) |
| Find files by pattern | `Glob` | `find` / `ls` in Bash (blocked) |
| Search inside file contents | `Grep` | `grep` / `rg` in Bash (blocked) |
| Extract fields from a local JSON file | `Read` the file, parse and filter in your response | `node -e "const x=require('./foo.json'); …"` — same data with ~100–300 ms of Node startup, raw stdout, and no rendering control |
| Check the board state (TODOs, planned) | `forge_read_board` MCP tool, or `Read .pipeline/board.json` | Shelling out with `node -e` to filter; reading `.pipeline/*` directly when MCP is available |
| Check dashboard state (active runs, pending gates, recent completions, board summary) | `forge_dashboard_state` MCP tool | Reading `.pipeline/runs/*.json` by hand |
| Check a specific run's full record | `forge_get_run` MCP tool with the run ID | `Read .pipeline/runs/r-*/run.json` when MCP is available |
| Check the active-run pointer / current unit | `forge_get_active_run` MCP tool | `Read .pipeline/run-active.json` directly |
| Check the pending gate | `forge_check_gate` MCP tool | `Read .pipeline/gate-pending.json` directly |
| Edit an existing file | `Edit` | `sed` / `awk` (blocked) |
| Create a new file | `Write` | `echo > file` / `cat <<EOF > file` (blocked) |
| Run tests | Bash → the project's configured test command | — |
| Run a project script | Bash → the script directly | `node -e '…'` inline (write a script file instead — preserves provenance and is re-runnable) |
| Git operations, npm, process / env | Bash | — |
| Delegate an open-ended multi-step investigation | `Agent` with the appropriate subagent type | Using `Agent` to read a single file or extract one field — Read/Grep/Glob are cheaper |

### Common FORGE data lookups — worked examples

**Check what's on the TODO board.**
Call `forge_read_board`. If MCP is unavailable, `Read .pipeline/board.json` and filter in your response. Never `node -e "const b=require('./.pipeline/board.json'); b.todos.filter(…)"` — it's slower, uglier, and unnecessary.

**Check current pipeline state (runs, gates, recent completions, board summary).**
Call `forge_dashboard_state`. Returns a compact four-group snapshot. Do not read `.pipeline/runs/*.json` individually — the tool's output is the contract.

**Check a specific run's full record.**
Call `forge_get_run` with the run ID. Returns the hydrated `run.json` contents.

### Hard rules (preserved for emphasis)

**No subagents for file reads.** Never use the `Agent` tool to read files, extract data, or answer questions that can be resolved with `Read`, `Grep`, or `Glob` directly. Subagents are for open-ended research across many files or protecting the main context from large outputs — not for single-file lookups.
