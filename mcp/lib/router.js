// router.js — model recommendation engine (ESM, pure function — no I/O)
// The router advises which model to use; it does NOT execute calls or write files.
//
// Routing priority stack:
//   0. capability-cost (PRIMARY) — all agents.
//      Agent declares requiredCapabilities (hard job requirements).
//      Router returns the model with the FEWEST total capabilities that
//      satisfies all requirements (most-minimal match — a task that needs
//      only [analysis] should not land on a model that also has reasoning +
//      agentic just because they share a cost tier). Ties on capability
//      count are broken by cost, then alphabetical id for determinism.
//      Default scope = all enabled providers; allowedVendors forces an
//      explicit override.
//      Explicit error if no model satisfies requirements.
//   1. hardcoded default — safety net for agents with no requirements declared.

const COST_TIER_ORDER = { free: 0, low: 1, medium: 2, high: 3 };

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_PROVIDER = 'anthropic';

/**
 * Returns the recommended model for an agent.
 *
 * @param {string} agentName - agent filename without extension (e.g. 'coder')
 * @param {object} config - parsed forge-config.json object
 * @param {object} usage - parsed usage.json object (or emptyUsage())
 * @param {{ budgetMode?: string, excludeModels?: string[] }} options
 *   excludeModels: model IDs to skip for this call only (runtime-only, not persisted).
 * @returns {{ modelId: string|null, providerId: string|null, source: string, reason: string }}
 */
export function recommendModel(agentName, config, usage, options = {}) {
  const excludeModels = Array.isArray(options.excludeModels) ? options.excludeModels : [];
  const agentEntry = config.agentModelMap?.[agentName];
  const requiredCaps = agentEntry?.requiredCapabilities || [];
  const allowedVendors = agentEntry?.allowedVendors ?? null;

  function getModelDef(modelId) {
    return (config.models || []).find(m => m.id === modelId) ?? null;
  }

  function isAvailable(modelId) {
    if (!modelId) return false;
    const def = getModelDef(modelId);
    if (!def) return false;
    const providerDef = (config.providers || []).find(p => p.id === def.providerId);
    if (!providerDef || !providerDef.enabled) return false;
    const providerUsage = usage.providers?.[def.providerId];
    // Provider-level exhaustion blocks all models from this provider.
    if (providerUsage?.quotaExhausted) return false;
    // Model-level exhaustion blocks only this specific model — other models on
    // the same provider remain reachable. Old-format usage.json has no models
    // key so this check is naturally a no-op for backward compatibility.
    if (providerUsage?.models?.[modelId]?.quotaExhausted === true) return false;
    return true;
  }

  // Priority 0: capability-cost routing — primary path for all agents.
  // Finds cheapest available model satisfying all required capabilities in provider scope.
  // Default scope = all enabled providers; allowedVendors forces a specific scope override.
  if (requiredCaps.length > 0) {
    const enabledProviderIds = (config.providers || []).filter(p => p.enabled).map(p => p.id);
    const providerScope = allowedVendors ? allowedVendors : enabledProviderIds;
    let capCandidates = (config.models || []).filter(m => {
      if (excludeModels.includes(m.id)) return false;
      if (!providerScope.includes(m.providerId)) return false;
      if (!isAvailable(m.id)) return false;
      const modelCaps = m.capabilities || [];
      return requiredCaps.every(cap => modelCaps.includes(cap));
    });

    if (capCandidates.length > 0) {
      // Sort order (most-minimal match wins):
      //   1. FEWEST total capabilities — prefer the model whose capability set is
      //      closest to what was actually requested. A task requiring [analysis]
      //      should not consume a model that also carries reasoning + agentic +
      //      long-context just because they share a cost tier. This keeps scarce
      //      capacity of over-capable models available for tasks that genuinely
      //      need those capabilities.
      //   2. Cheapest cost tier — break capability-count ties by price.
      //   3. Alphabetical model id — final deterministic tiebreak.
      capCandidates.sort((a, b) => {
        const aCaps = (a.capabilities || []).length;
        const bCaps = (b.capabilities || []).length;
        if (aCaps !== bCaps) return aCaps - bCaps;
        const aCost = COST_TIER_ORDER[a.costTier] ?? 1;
        const bCost = COST_TIER_ORDER[b.costTier] ?? 1;
        if (aCost !== bCost) return aCost - bCost;
        return a.id.localeCompare(b.id);
      });
      const chosen = capCandidates[0];
      return {
        modelId: chosen.id,
        providerId: chosen.providerId,
        source: 'capability-cost',
        reason: `Most-minimal-match available model in [${providerScope.join(', ')}] satisfying [${requiredCaps.join(', ')}]`,
      };
    }

    // No match — fail explicitly; capability requirements are hard constraints
    return {
      modelId: null,
      providerId: null,
      source: 'error',
      reason: `No available model found with capabilities [${requiredCaps.join(', ')}] in scope [${providerScope.join(', ')}] for agent "${agentName}"`,
    };
  }

  // Priority 1: hardcoded default — safety net for agents with no requirements.
  return {
    modelId: DEFAULT_MODEL,
    providerId: DEFAULT_PROVIDER,
    source: 'default',
    reason: 'No routing requirements declared; using hardcoded default',
  };
}
