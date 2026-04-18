# Security Audit — Pass 4, Pass 1 (Credential Leakage & Supply Chain)

Date: 2026-04-17. Clean-slate adversarial pass. All findings are based on reading actual source files.

---

## 1. gemini-adapter.js — API key handling and error sanitization

**RESOLVED.** API key is sent via `x-goog-api-key` request header, never as a `?key=` query parameter. The comment in the file explicitly documents why (`proxy/CDN/load-balancer log exposure`). `modelId` is passed through `encodeURIComponent()` before being interpolated into the URL path, preventing path-traversal or injection via a crafted model string. Error messages are sanitized by `sanitizeErrorMessage()`, which extracts only `error.status` or `error.code` from JSON responses and falls back to the bare HTTP status code — raw response bodies (which may echo the key on 401) are never surfaced to the caller.

## 2. openai-adapter.js — API key handling and error sanitization

**RESOLVED.** API key is sent via `Authorization: Bearer <key>` header only — never in the URL. `modelId` goes into the JSON request body (`body.model = modelId`), not into the URL, so URL-encoding is not applicable and there is no injection vector. `sanitizeErrorMessage()` follows the same pattern as the Gemini adapter: extracts `error.type` or `error.code` only, never the raw body.

## 3. config-store.js — Schema validation on config load

**RESOLVED.** `validateForgeConfig()` runs on every `readForgeConfig()` call before the config object is returned to any caller. It enforces: `providers` is a required array; each provider has a known `type` (allowlist: `anthropic`, `openai`, `gemini`); each `envVar` matches `/^[A-Z][A-Z0-9_]{0,99}$/` (blocks shell injection strings like `$()`, path traversal, lowercase tricks). `models` and `agentModelMap` are validated for structural shape. A malformed config throws before any API key resolution occurs.

## 4. forge-config.default.json — Hardcoded key values

**RESOLVED.** No API key values anywhere in the file. All provider entries use only `envVar` field names (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) — no `apiKey`, `key`, `secret`, or `token` fields. The file is safe to commit and distribute.

## 5. .gitignore — Sensitive runtime files

**RESOLVED.** All four items under audit are explicitly listed:
- `bin/forge.cmd` — listed with comment explaining it contains username and machine paths
- `bin/forge-mcp-server.cmd` — listed in the same block
- `.pipeline/forge-config.json` — listed with comment that it is per-user operational state
- `.pipeline/usage.json` — listed in the same block

No gaps found.

## 6. hooks/mcp-deps-install.js — npm ci vs npm install, execSync vs execFileSync

**RESOLVED.** The hook uses `execFileSync` exclusively — `execSync` (which invokes a shell and enables injection) is not used anywhere in the file. The `runNpm()` helper passes all arguments as an array, never as a shell string. Install strategy: `npm ci` is used when `package-lock.json` is present (deterministic, lockfile-bound); `npm install` is used only as a fallback when no lockfile exists, with the label `npm install (no lockfile)` logged to stderr so the condition is visible. This is the correct posture.

## 7. mcp/package.json and packages/forge-core/package.json — Dependency ranges and sources

**STILL OPEN (minor).** All dependencies use npm registry sources with caret ranges (`^`). No git URLs, file paths, or non-registry sources. The ranges are:

- `mcp/package.json`: `@modelcontextprotocol/sdk ^1.29.0`, `zod ^3.25.0`, `node-pty ^1.1.0`, `blessed ^0.1.81`, `ink ^5.0.0`, `react ^18.0.0`, `@xterm/headless ^6.0.0`, `pngjs ^7.0.0`
- `packages/forge-core/package.json`: `zod ^3.25.0` only

The open item: caret ranges allow minor and patch drift at install time. When `package-lock.json` is present and `npm ci` is used (which it is, per finding 6), this is mitigated — the lockfile pins exact versions. The residual risk is that the lockfile itself could drift if regenerated without review. This is normal npm hygiene, not a specific vulnerability, but worth noting for supply-chain awareness. No `node-pty` or `blessed` version pinning audit was performed here (native addons in those packages have historically had vulnerabilities).

## 8. mcp/server.js forge_call_external — modelId validation against catalog

**STILL OPEN.** The `forge_call_external` handler validates that the `providerId` exists in config and is enabled, and that the provider `type` is known (`openai` or `gemini`). However, `modelId` is passed directly to the adapter without being checked against the `config.models` catalog. An LLM or caller could supply any arbitrary string as `modelId` (e.g. `../../../etc/passwd`, a non-existent model, or a model from a different provider's catalog). For Gemini, the modelId is `encodeURIComponent()`'d in the URL path (safe). For OpenAI, it goes into the JSON body `model` field (no injection vector, but a wrong model ID wastes quota and may return a confusing API error). The practical impact is low — no credential exposure, no code execution — but the catalog check is a documented design intent that has not been implemented. A one-line fix: after resolving the provider, confirm that `config.models.find(m => m.id === modelId && m.providerId === provider.id)` exists before dispatching.
