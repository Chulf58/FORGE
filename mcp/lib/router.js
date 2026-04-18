// router.js — model recommendation engine (ESM, pure function — no I/O)
// The router advises which model to use; it does NOT execute calls or write files.
//
// Current routing priority stack:
//   0. capability-cost (PRIMARY) — all agents.
//      Agent declares requiredCapabilities (hard job requirements).
//      Router returns cheapest available model satisfying all required capabilities
//      in the provider scope (Anthropic by default; allowedVendors overrides).
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
    const exhausted = usage.providers?.[def.providerId]?.quotaExhausted ?? false;
    return !exhausted;
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
      // Sort cheapest first; break cost-tier ties alphabetically for determinism
      capCandidates.sort((a, b) => {
        const aOrd = COST_TIER_ORDER[a.costTier] ?? 1;
        const bOrd = COST_TIER_ORDER[b.costTier] ?? 1;
        if (aOrd !== bOrd) return aOrd - bOrd;
        return a.id.localeCompare(b.id);
      });
      const chosen = capCandidates[0];
      return {
        modelId: chosen.id,
        providerId: chosen.providerId,
        source: 'capability-cost',
        reason: `Cheapest available model in [${providerScope.join(', ')}] matching [${requiredCaps.join(', ')}]`,
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
