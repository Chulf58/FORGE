import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readForgeConfig, writeForgeConfig, resolvePluginDataDir } from '../config-store.js';
import { readUsage, writeUsage, markModelQuotaExhausted, recordUsage } from '../usage-store.js';
import { recommendModel } from '../router.js';
import { callOpenAI } from '../openai-adapter.js';
import { addModelToConfig, updateModelInConfig } from '../model-validation.js';

// Session dispatch log — consumed by hooks/routing-enforcement.js.
// Shape: { entries: [{ agentName, ts, modelId, providerId }] }
// Capped at 200 entries; entries older than 30 minutes are pruned on write.
const DISPATCH_LOG_RELATIVE = '.pipeline/session-dispatch-log.json';
const DISPATCH_LOG_MAX_ENTRIES = 200;
const DISPATCH_LOG_PRUNE_MS = 30 * 60 * 1000;

function appendDispatchLogEntry(projectDir, agentName, recommendation, writeJsonSafe) {
  const logPath = join(projectDir, DISPATCH_LOG_RELATIVE);
  let data = { entries: [] };
  try {
    if (existsSync(logPath)) {
      const raw = readFileSync(logPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entries)) data = parsed;
    }
  } catch (_) {
    data = { entries: [] };
  }

  const now = Date.now();
  // Prune stale entries before appending — keep the log bounded.
  const fresh = data.entries.filter(e =>
    e && typeof e.ts === 'number' && now - e.ts <= DISPATCH_LOG_PRUNE_MS && e.ts <= now
  );
  fresh.push({
    agentName,
    ts: now,
    modelId: recommendation.modelId,
    providerId: recommendation.providerId,
  });

  // Cap total size to prevent unbounded growth if recommendations are called
  // very rapidly; the newest entries are the ones that matter.
  const capped = fresh.slice(-DISPATCH_LOG_MAX_ENTRIES);
  writeJsonSafe(logPath, { entries: capped });
}

export function register(server, shared) {
  const { resolveProjectDir, writeJsonSafe, errorResult, textResult } = shared;

  // -- Tool: forge_get_model_recommendation ------------------------------------

  server.registerTool(
    'forge_get_model_recommendation',
    {
      title: 'FORGE Get Model Recommendation',
      description: 'Returns the recommended model for a given agent based on capability match, cost tier, and provider availability.',
      inputSchema: z.object({
        agentName: z.string().describe("Agent name (e.g. 'coder', 'reviewer-safety')"),
        budgetMode: z.enum(['economy', 'standard', 'performance']).default('standard').describe('Budget mode — economy prefers low-cost models, performance prefers high-capability models'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ agentName, budgetMode }) => {
      try {
        const projectDir = resolveProjectDir();
        const pluginDataDir = resolvePluginDataDir();
        const { config } = readForgeConfig(pluginDataDir, projectDir);
        const usage = readUsage(projectDir);
        const recommendation = recommendModel(agentName, config, usage, { budgetMode });

        // Record this recommendation in the session dispatch log so the
        // routing-enforcement PreToolUse hook can authorize a matching Agent
        // spawn. Only record successful recommendations — errors do not grant
        // any downstream authorization. Best-effort: log write failures must
        // not break the tool call itself.
        if (recommendation.source !== 'error' && recommendation.modelId) {
          try { appendDispatchLogEntry(projectDir, agentName, recommendation, writeJsonSafe); } catch (_) { /* best-effort */ }
        }

        return textResult(recommendation);
      } catch (err) {
        return errorResult('forge_get_model_recommendation failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_call_external -----------------------------------------------

  server.registerTool(
    'forge_call_external',
    {
      title: 'FORGE Call External Provider',
      description: 'Sends a prompt to an external provider (e.g. OpenAI Codex). For Anthropic models, use agent frontmatter instead — this tool is only for providers that cannot be expressed as a Claude Code subagent model.',
      inputSchema: z.object({
        providerId: z.string().describe("Provider ID from forge-config.json (e.g. 'openai')"),
        modelId: z.string().describe("Model ID to call (e.g. 'codex-mini-latest')"),
        prompt: z.string().describe('Prompt text to send'),
        maxTokens: z.number().optional().describe('Max output tokens (default: 4096)'),
        reasoningEffort: z.enum(['none', 'low', 'medium', 'high', 'xhigh']).optional().describe('Reasoning effort level for models that support it (e.g. gpt-5.4). Ignored by providers that do not support it.'),
        agentName: z.string().optional().describe("Agent name for automatic rerouting on transient failure (e.g. 'supervisor'). When provided, a 503-exhausted call re-runs model selection with the failed model excluded and retries the next cheapest valid model."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ providerId, modelId, prompt, maxTokens, reasoningEffort, agentName }) => {
      // Prompt size limit — prevents exfiltration of large file contents
      const MAX_PROMPT_CHARS = 100_000;
      if (prompt.length > MAX_PROMPT_CHARS) {
        return errorResult('Prompt exceeds ' + MAX_PROMPT_CHARS + ' character limit (' + prompt.length + ' chars). Trim the prompt.');
      }

      // Maximum number of model reroutes on transient 503 — prevents infinite loops
      const MAX_REROUTES = 3;

      try {
        const projectDir = resolveProjectDir();
        const pluginDataDir = resolvePluginDataDir();
        const { config } = readForgeConfig(pluginDataDir, projectDir);
        const usage = readUsage(projectDir);

        // Mutable call state — updated on reroute (runtime-only, never persisted)
        let currentProviderId = providerId;
        let currentModelId = modelId;
        const excludeModels = [];

        for (let attempt = 0; attempt <= MAX_REROUTES; attempt++) {
          // Find and validate provider
          const provider = (config.providers || []).find(p => p.id === currentProviderId);
          if (!provider || !provider.enabled) {
            return errorResult('Provider not found or disabled: ' + currentProviderId);
          }

          // Validate modelId is in the catalog for this provider
          const modelInCatalog = (config.models || []).find(m => m.id === currentModelId && m.providerId === currentProviderId);
          if (!modelInCatalog) {
            return errorResult('Model "' + currentModelId + '" not found in catalog for provider "' + currentProviderId + '"');
          }

          // Resolve API key — reject undefined and empty string
          const apiKey = process.env[provider.envVar];
          if (!apiKey) {
            return errorResult('API key env var not set or empty: ' + provider.envVar);
          }

          let result;
          try {
            if (provider.type === 'openai') {
              result = await callOpenAI(prompt, currentModelId, apiKey, { maxTokens, reasoningEffort });
            } else {
              return errorResult('Provider type not supported: ' + provider.type);
            }
          } catch (callErr) {
            const msg = callErr.message || '';
            // Use structured adapter metadata for reroute decisions — avoids brittle string matching.
            // Adapters set err.transient = true on 503 (service overloaded, bounded retries exhausted).
            const isTransient = callErr.transient === true;
            // Split quota classification so one exhausted model does not poison every other
            // model from the same provider:
            //   401 (auth/billing) — applies to the whole provider (bad key, disabled billing)
            //   429 / "quota" string — per-model rate or quota failure; mark only this model
            // Detect auth errors by the exact prefix produced by sanitizeErrorMessage —
            // "OpenAI API error 401: ..." or "OpenAI API error 403: ...". Using the
            // prefix avoids false positives from response body content that happens
            // to contain "401" or "403" as data.
            const isAuthError = msg.startsWith('OpenAI API error 401') || msg.startsWith('OpenAI API error 403');
            const isQuotaError = msg.includes('429') || msg.toLowerCase().includes('quota');

            if (isAuthError) {
              // Auth errors (401 invalid key, 403 forbidden) are NOT quota exhaustion.
              // Return immediately with a descriptive message — do NOT mark provider exhausted.
              return errorResult(
                'API key invalid, expired, or forbidden for provider "' + currentProviderId +
                '" (' + msg + '): check the API key configured in the provider\'s envVar.'
              );
            } else if (isQuotaError) {
              try { markModelQuotaExhausted(projectDir, currentProviderId, currentModelId); } catch (_) { /* best-effort */ }
            }

            // On transient 503 after adapter retries exhausted: reroute if agentName provided
            if (isTransient && agentName && attempt < MAX_REROUTES) {
              excludeModels.push(currentModelId);
              const next = recommendModel(agentName, config, usage, { excludeModels });
              if (next.source === 'error' || !next.modelId) {
                return errorResult(
                  'External call failed (all candidates exhausted after transient failures): ' + msg
                );
              }
              currentProviderId = next.providerId;
              currentModelId = next.modelId;
              continue; // retry with next cheapest valid model
            }

            return errorResult('External call failed: ' + msg);
          }

          // Success — record usage and return
          if (config.quotaTracking) {
            try {
              recordUsage(projectDir, currentProviderId, result.inputTokens + result.outputTokens, currentModelId);
            } catch (_) { /* best-effort */ }
          }

          return textResult({
            text: result.text,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          });
        }

        // Unreachable — loop always returns or continues, but satisfies linters
        return errorResult('forge_call_external: reroute limit exceeded');
      } catch (err) {
        return errorResult('forge_call_external failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_read_usage --------------------------------------------------

  server.registerTool(
    'forge_read_usage',
    {
      title: 'FORGE Read Usage',
      description: 'Returns the current provider usage state from .pipeline/usage.json',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        const projectDir = resolveProjectDir();
        const usage = readUsage(projectDir);
        return textResult(usage);
      } catch (err) {
        return errorResult('forge_read_usage failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_reset_usage -------------------------------------------------

  server.registerTool(
    'forge_reset_usage',
    {
      title: 'FORGE Reset Usage',
      description: 'Resets provider usage counters. Resets all providers if providerId is omitted.',
      inputSchema: z.object({
        providerId: z.string().optional().describe('Reset a specific provider, or all if omitted'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ providerId }) => {
      try {
        const projectDir = resolveProjectDir();
        const usage = readUsage(projectDir);
        if (!usage.providers) usage.providers = {};

        // Rate-limit resets to prevent infinite retry loops
        if (usage.updatedAt) {
          const lastUpdate = new Date(usage.updatedAt);
          const elapsed = Date.now() - lastUpdate.getTime();
          if (elapsed < 60_000) {
            return errorResult('Usage was reset less than 60 seconds ago. Wait before retrying.');
          }
        }

        const resetAt = new Date().toISOString();

        // Clears provider-level AND any per-model quotaExhausted flags so users
        // can recover from a per-model exhaustion without having to hand-edit
        // usage.json.
        function resetProviderEntry(id) {
          const entry = usage.providers[id];
          entry.requestCount = 0;
          entry.tokenCount = 0;
          entry.quotaExhausted = false;
          entry.lastUsed = null;
          entry.resetAt = resetAt;
          if (entry.models) {
            for (const mId of Object.keys(entry.models)) {
              entry.models[mId].quotaExhausted = false;
            }
          }
        }

        if (providerId) {
          // Reset only the specified provider (create zeroed entry if not yet tracked)
          if (!usage.providers[providerId]) {
            usage.providers[providerId] = {
              requestCount: 0,
              tokenCount: 0,
              lastUsed: null,
              quotaExhausted: false,
              resetAt,
            };
          } else {
            resetProviderEntry(providerId);
          }
        } else {
          // Reset all known providers
          for (const id of Object.keys(usage.providers)) {
            resetProviderEntry(id);
          }
        }

        usage.updatedAt = resetAt;
        writeUsage(projectDir, usage);
        return textResult(usage);
      } catch (err) {
        return errorResult('forge_reset_usage failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_update_agent_model ------------------------------------------

  server.registerTool(
    'forge_update_agent_model',
    {
      title: 'FORGE Update Agent Model',
      description: 'Updates the preferred or fallback model for a named agent in forge-config.json',
      inputSchema: z.object({
        agentName: z.string().describe('Agent name (must exist in agentModelMap)'),
        preferred: z.string().optional().describe('New preferred model ID'),
        fallback: z.string().optional().describe('New fallback model ID'),
        requiredCapabilities: z.array(z.string()).optional().describe('Required capability tags'),
        allowedVendors: z.array(z.string()).optional().describe("Restrict routing to these provider IDs only (e.g. ['anthropic'])"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ agentName, preferred, fallback, requiredCapabilities, allowedVendors }) => {
      try {
        const projectDir = resolveProjectDir();
        const pluginDataDir = resolvePluginDataDir();
        const { config, configPath } = readForgeConfig(pluginDataDir, projectDir);

        if (!config.agentModelMap || !config.agentModelMap[agentName]) {
          return errorResult('Agent not in agentModelMap: ' + agentName);
        }

        // Reviewer agents must stay on Anthropic — block vendor redirection
        const LOCKED_VENDOR_AGENTS = [
          'reviewer-safety', 'reviewer-boundary', 'reviewer-logic',
          'reviewer-style', 'reviewer-performance', 'reviewer-triage',
        ];
        if (allowedVendors !== undefined && LOCKED_VENDOR_AGENTS.includes(agentName)) {
          if (!allowedVendors.includes('anthropic')) {
            return errorResult(
              "Reviewer agents must include 'anthropic' in allowedVendors. " +
              'Routing reviewers to non-Anthropic providers is not allowed.'
            );
          }
        }

        // Apply provided fields in-place
        const entry = config.agentModelMap[agentName];
        if (preferred !== undefined) entry.preferred = preferred;
        if (fallback !== undefined) entry.fallback = fallback;
        if (requiredCapabilities !== undefined) entry.requiredCapabilities = requiredCapabilities;
        if (allowedVendors !== undefined) entry.allowedVendors = allowedVendors;

        writeForgeConfig(configPath, config);
        return textResult(config.agentModelMap[agentName]);
      } catch (err) {
        return errorResult('forge_update_agent_model failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_add_model ---------------------------------------------------

  server.registerTool(
    'forge_add_model',
    {
      title: 'FORGE Add Model',
      description: 'Adds a new model to the catalog in forge-config.json. Validates capabilities against a fixed allowlist (reasoning, code, analysis, fast, agentic, long-context), rejects duplicate IDs, verifies providerId exists, and enforces numeric pricing shape. Prevents typos and invalid entries from silently breaking routing.',
      inputSchema: z.object({
        id: z.string().min(1).describe("Unique model ID (e.g. 'claude-haiku-4-5-20251001')"),
        providerId: z.string().min(1).describe('Provider ID — must match an existing provider in config.providers'),
        capabilities: z.array(z.string()).min(1).describe('Capability tags from the allowlist: reasoning, code, analysis, fast, agentic, long-context'),
        costTier: z.enum(['free', 'low', 'medium', 'high']).describe('Coarse cost bucket'),
        pricing: z.object({
          input: z.number().nonnegative(),
          output: z.number().nonnegative(),
          cached: z.number().nonnegative(),
        }).describe('Per-1M-token pricing in USD'),
        contextWindow: z.number().int().positive().optional().describe('Max context window in tokens'),
        reasoningTier: z.enum(['haiku', 'sonnet', 'opus']).optional().describe('Descriptive tier label (metadata only)'),
        notes: z.string().optional().describe('Human-readable notes'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (params) => {
      try {
        const projectDir = resolveProjectDir();
        const pluginDataDir = resolvePluginDataDir();
        const { config, configPath } = readForgeConfig(pluginDataDir, projectDir);

        const result = addModelToConfig(config, params);
        if (!result.ok) {
          return errorResult('forge_add_model: ' + result.error);
        }

        writeForgeConfig(configPath, config);
        return textResult(result.entry);
      } catch (err) {
        return errorResult('forge_add_model failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_update_model ------------------------------------------------

  server.registerTool(
    'forge_update_model',
    {
      title: 'FORGE Update Model',
      description: 'Updates fields on an existing model catalog entry. Only touched fields are revalidated and replaced; untouched fields are preserved. The model id itself cannot be changed. Use forge_add_model for new entries.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Model ID to update (must exist in catalog)'),
        providerId: z.string().min(1).optional().describe('New providerId (must match an existing provider)'),
        capabilities: z.array(z.string()).min(1).optional().describe('New capability set — replaces previous; must come from the allowlist'),
        costTier: z.enum(['free', 'low', 'medium', 'high']).optional(),
        pricing: z.object({
          input: z.number().nonnegative(),
          output: z.number().nonnegative(),
          cached: z.number().nonnegative(),
        }).optional().describe('New pricing — replaces previous'),
        contextWindow: z.number().int().positive().optional(),
        reasoningTier: z.enum(['haiku', 'sonnet', 'opus']).optional(),
        notes: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (params) => {
      try {
        const projectDir = resolveProjectDir();
        const pluginDataDir = resolvePluginDataDir();
        const { config, configPath } = readForgeConfig(pluginDataDir, projectDir);

        const result = updateModelInConfig(config, params);
        if (!result.ok) {
          return errorResult('forge_update_model: ' + result.error);
        }

        writeForgeConfig(configPath, config);
        return textResult(result.entry);
      } catch (err) {
        return errorResult('forge_update_model failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_list_models -------------------------------------------------

  server.registerTool(
    'forge_list_models',
    {
      title: 'FORGE List Models',
      description: 'Returns the model catalog from forge-config.json, optionally filtered by provider or capability',
      inputSchema: z.object({
        providerId: z.string().optional().describe('Filter by provider ID'),
        capability: z.string().optional().describe('Filter by required capability tag'),
        availableOnly: z.boolean().default(false).describe('If true, exclude models whose provider OR the model itself has quotaExhausted: true'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ providerId, capability, availableOnly }) => {
      try {
        const projectDir = resolveProjectDir();
        const pluginDataDir = resolvePluginDataDir();
        const { config } = readForgeConfig(pluginDataDir, projectDir);
        const usage = readUsage(projectDir);

        let models = config.models || [];

        // Filter by provider
        if (providerId) {
          models = models.filter(m => m.providerId === providerId);
        }

        // Filter by capability tag
        if (capability) {
          models = models.filter(m => (m.capabilities || []).includes(capability));
        }

        // Filter by availability — excludes a model if EITHER the provider is
        // marked exhausted (auth/billing-wide) OR this specific model is marked
        // exhausted (per-model quota). Backward compatible with old-format
        // usage.json that only carries provider-level flags.
        if (availableOnly) {
          models = models.filter(m => {
            const providerUsage = usage.providers?.[m.providerId];
            if (providerUsage?.quotaExhausted) return false;
            if (providerUsage?.models?.[m.id]?.quotaExhausted === true) return false;
            return true;
          });
        }

        return textResult(models);
      } catch (err) {
        return errorResult('forge_list_models failed: ' + err.message);
      }
    },
  );
}
