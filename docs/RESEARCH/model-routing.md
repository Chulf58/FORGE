# Research: Intelligent Model Routing for FORGE Pipeline

## Key facts

- `CLAUDE_PLUGIN_ROOT` is NOT reliably set in MCP server subprocess environments; use `${CLAUDE_PLUGIN_DATA}` (persistent across updates) for config files instead of `${CLAUDE_PLUGIN_ROOT}` (version-scoped, read-only)
- OpenAI Responses API endpoint is `/v1/responses`, not `/v1/chat/completions`; request body uses `input` field (not `messages`), authentication is `Authorization: Bearer <token>`, response includes `usage` object with `prompt_tokens`, `completion_tokens`, `total_tokens`
- Never store plaintext API keys in config files; always reference via environment variable names only (`envVar` field in provider config); MCP server resolves `process.env[provider.envVar]` at call time

## Findings

### Question 1: CLAUDE_PLUGIN_ROOT availability in MCP server process

**Finding:** `CLAUDE_PLUGIN_ROOT` is **not reliably set** in MCP server subprocess environments spawned via `.mcp.json`. While the variable is expanded in `.mcp.json` `args` array values and in hook commands, it is NOT consistently passed as an environment variable to the MCP subprocess itself. This is a known limitation documented in GitHub issues #27145 and #24529.

Additionally, `CLAUDE_PLUGIN_ROOT` points to the plugin cache directory and changes on every plugin update — files written there do not survive updates. For persistent config like `forge-config.json` that must be writable and durable across sessions and updates, this is not suitable.

**Solution:** Use `${CLAUDE_PLUGIN_DATA}` for `forge-config.json`. This variable is explicitly designed for persistent storage that survives plugin updates. The directory resolves to `~/.claude/plugins/data/{plugin-id}/` and is automatically created on first use.

In the MCP server, resolve the plugin data directory via:
```javascript
function resolvePluginDataDir() {
  // CLAUDE_PLUGIN_DATA is set by Claude Code when MCP server is spawned
  // Falls back to computing the data directory path if env var is missing
  if (process.env.CLAUDE_PLUGIN_DATA) {
    return process.env.CLAUDE_PLUGIN_DATA;
  }
  // Fallback: compute the path (use plugin ID from config or derive from CLAUDE_PLUGIN_ROOT)
  const os = require('os');
  return path.join(os.homedir(), '.claude', 'plugins', 'data', 'forge'); // or similar
}
```

**Alternative if `CLAUDE_PLUGIN_DATA` is also unavailable:** Fall back to per-project storage in `.pipeline/forge-config.json` (project-scoped). This trades global reusability for guaranteed availability, but is simpler and follows the existing `.pipeline/` pattern.

**Source:** 
- GitHub issue #27145: CLAUDE_PLUGIN_ROOT not set for SessionStart hooks (2026)
- GitHub issue #15642: Plugin cache contains stale version after updates
- Claude Code plugins reference documentation: `${CLAUDE_PLUGIN_DATA}` for persistent data

**Recommendation:** 
1. Place `forge-config.json` in `.pipeline/forge-config.json` (project-scoped, guaranteed writable) OR in `${CLAUDE_PLUGIN_DATA}/forge-config.json` (persistent, but requires fallback logic).
2. If using `${CLAUDE_PLUGIN_DATA}`, add explicit fallback to derive the data directory from `process.env.CLAUDE_PLUGIN_ROOT || process.cwd()` in case the env var is missing.
3. Refactor `mcp/lib/config-store.js` to accept a `pluginDataDir` parameter so the MCP server can pass the resolved directory explicitly rather than having the module try to resolve it independently.

---

### Question 2: OpenAI Responses API for codex-mini-latest

**Finding:** The OpenAI Responses API is a structured output API designed for code generation and complex tasks. Key details:

**Endpoint:** `POST https://api.openai.com/v1/responses`

**Request Body Format:**
```json
{
  "model": "codex-mini-latest",
  "input": "<prompt text>",
  "max_output_tokens": 4096
}
```
- `input` field contains the prompt (NOT `messages` array like Chat Completions)
- `max_output_tokens` is optional; defaults to some reasonable value
- No `stream` parameter — responses are single-shot (non-streaming) only

**Authentication:** Standard Bearer token in Authorization header:
```
Authorization: Bearer <API_KEY>
```

**Response Format:**
```json
{
  "id": "resp_...",
  "created_at": "2024-...",
  "model": "codex-mini-latest",
  "output": "<generated text>",
  "usage": {
    "prompt_tokens": 123,
    "completion_tokens": 456,
    "total_tokens": 579
  }
}
```

**Streaming:** NOT supported via the Responses API. This API is single-shot only — no server-sent events or streaming chunks. The entire response is returned in one HTTP response.

**Status codes:** 
- 2xx = success
- 401 = invalid or missing API key (quota exhausted scenarios also return 401 or 429)
- 4xx = client errors
- 5xx = server errors

**Error responses:** Include error messages in the response body; parse JSON even on non-2xx status to extract error details.

**Source:**
- OpenAI API documentation: Responses API format
- Langflow OpenAI Responses integration documentation: request/response schema
- Azure OpenAI Responses API documentation: compatible format

**Recommendation:** 
1. Implement `mcp/lib/openai-adapter.js` to POST to `/v1/responses` with `{ model, input, maxTokens }` and parse response for `output` and `usage`.
2. No retry logic or streaming complexity needed — Responses API is simple single-shot.
3. Add error handling for 401 responses to trigger quota exhaustion tracking in usage-store.
4. Extract token counts from `usage.prompt_tokens + usage.completion_tokens` to track quota per-provider.

---

### Question 3: forge-config.json placement

**Finding:** Three viable options exist, each with trade-offs:

**Option A: Plugin root via `${CLAUDE_PLUGIN_ROOT}` — NOT RECOMMENDED**
- Pro: Config is bundled with the plugin, easy to distribute
- Con: NOT writable; files written here are deleted on plugin updates; variable not reliably available in MCP subprocess
- Verdict: Not suitable for user-editable config that must persist across sessions and updates

**Option B: Plugin data directory via `${CLAUDE_PLUGIN_DATA}` — RECOMMENDED**
- Pro: Persistent across plugin updates; survives until plugin is uninstalled; Claude Code manages directory creation and cleanup
- Con: Requires fallback logic if env var is missing; path is somewhat opaque (`~/.claude/plugins/data/forge/`)
- Verdict: Best for global, persistent, user-configurable model catalog and provider registry

**Option C: Project-scoped `.pipeline/forge-config.json` — ACCEPTABLE ALTERNATIVE**
- Pro: Simple, guaranteed writable, follows existing `.pipeline/` pattern, project-local overrides possible
- Con: Not shared across projects; requires duplicating config; less suitable for global model catalog
- Verdict: Good for per-project overrides if Option B is used as fallback

**Recommendation:** 
1. **Primary:** Use `${CLAUDE_PLUGIN_DATA}/forge-config.json` (persistent, survives updates). Resolves to `~/.claude/plugins/data/forge/forge-config.json` or similar.
2. **Fallback:** If `CLAUDE_PLUGIN_DATA` env var is missing, fall back to `.pipeline/forge-config.json` (per-project, guaranteed available).
3. **Implementation in `mcp/lib/config-store.js`:**
   - Function `readForgeConfig(pluginDataDir, projectDir)` attempts `pluginDataDir/forge-config.json` first, then falls back to `projectDir/.pipeline/forge-config.json`
   - Write always goes to the same location where the file was read
   - MCP server passes both directories explicitly to avoid module-level resolution

4. **Initial default config:** Create a default `forge-config.json` in the plugin source (checked into Git) for bundled distribution. On first session, the SessionStart hook copies this to `${CLAUDE_PLUGIN_DATA}` if missing.

---

### Additional constraint discovered: Environment variable expansion in plugin `.mcp.json`

**Finding:** GitHub issue #9427 reports a known bug where `${VAR}` syntax in `.mcp.json` located in plugin directories is NOT expanded at all — the literal string `"${VAR}"` is passed to the MCP server. However, the issue is **marked as closed** (updated 2026-01-01), suggesting it may be fixed in recent Claude Code versions.

Until confirmed fixed, workaround: Use `${CLAUDE_PLUGIN_ROOT}` for paths (confirmed to work) and hardcode API key env var names in provider config (do NOT use `${OPENAI_API_KEY}` syntax in `.mcp.json` — instead, name the env var in the provider config object and let the MCP server resolve it via `process.env[]`).

**Source:** GitHub issue #9427: "env variable expansion not working in plugin .mcp.json"

**Recommendation:** For API key references in `.mcp.json`, avoid `${VAR}` substitution. Instead, declare the env var name in the provider config and resolve at runtime in the MCP tool handler.

