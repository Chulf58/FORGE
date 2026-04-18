// router.js — model recommendation engine (ESM, pure function — no I/O)
// The router advises which model to use; it does NOT execute calls or write files.
//
// Current routing priority stack:
//   0. capability-cost (PRIMARY) — agents with requiredCapabilities and no allowedTiers.
//      Finds cheapest available model in provider scope satisfying all required capabilities.
//      Anthropic-only by default; allowedVendors overrides scope. Fails explicitly if no match.
//   1. preferred pin — specific model override (supervisor uses this for gpt-5.4).
//      Config error if pinned model's tier violates allowedTiers.
//   2. allowedTiers scan — tier-locked catalog search (supervisor fallback when gpt-5.4 unavailable).
//      Fails explicitly if no candidate in tier/vendor constraints.
//   3. hardcoded default — safety net for fully unconstrained agents.

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

  function providerIdForModel(modelId) {
    return getModelDef(modelId)?.providerId ?? null;
  }

  function providerPriority(providerId) {
    const def = (config.providers || []).find(p => p.id === providerId);
    return def?.priority ?? 999;
  }

  const allowedTiers = agentEntry?.allowedTiers ?? null;
  const allowedVendors = agentEntry?.allowedVendors ?? null;
  const requiredCaps = agentEntry?.requiredCapabilities || [];

  // Priority 0: capability-cost routing — primary path for Claude agents.
  // Activates when agent declares requiredCapabilities AND has no allowedTiers.
  // Returns the cheapest available model satisfying all required capabilities
  // within the provider scope (Anthropic by default; allowedVendors if declared).
  if (requiredCaps.length > 0 && !allowedTiers) {
    const providerScope = allowedVendors ? allowedVendors : ['anthropic'];
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

  // Priority 1: preferred model pin (supervisor uses this for gpt-5.4).
  // Config error if the pinned model's tier violates allowedTiers.
  if (agentEntry?.preferred && !excludeModels.includes(agentEntry.preferred)) {
    const prefDef = getModelDef(agentEntry.preferred);
    if (prefDef && allowedTiers && !allowedTiers.includes(prefDef.reasoningTier)) {
      return {
        modelId: null,
        providerId: null,
        source: 'error',
        reason: `Config error: preferred model "${agentEntry.preferred}" has tier "${prefDef.reasoningTier}" which is not in allowedTiers [${allowedTiers.join(', ')}] for agent "${agentName}"`,
      };
    }
    if (isAvailable(agentEntry.preferred)) {
      return {
        modelId: agentEntry.preferred,
        providerId: providerIdForModel(agentEntry.preferred),
        source: 'preferred',
        reason: 'Agent preferred model is available',
      };
    }
  }

  // Priority 2: allowedTiers catalog scan (supervisor fallback when preferred is unavailable).
  // Fails explicitly if no valid candidate within tier/vendor constraints.
  if (allowedTiers) {
    let candidates = (config.models || []).filter(m => {
      if (excludeModels.includes(m.id)) return false;
      if (!isAvailable(m.id)) return false;
      if (!allowedTiers.includes(m.reasoningTier)) return false;
      if (allowedVendors && !allowedVendors.includes(m.providerId)) return false;
      return true;
    });

    if (candidates.length > 0) {
      // Sort: tier preference (index in allowedTiers) first, then provider priority as tiebreaker
      candidates.sort((a, b) => {
        const aTierIdx = allowedTiers.indexOf(a.reasoningTier);
        const bTierIdx = allowedTiers.indexOf(b.reasoningTier);
        if (aTierIdx !== bTierIdx) return aTierIdx - bTierIdx;
        return providerPriority(a.providerId) - providerPriority(b.providerId);
      });
      const chosen = candidates[0];
      return {
        modelId: chosen.id,
        providerId: chosen.providerId,
        source: 'catalog',
        reason: `Selected from tier-locked catalog (allowedTiers: [${allowedTiers.join(', ')}])`,
      };
    }

    return {
      modelId: null,
      providerId: null,
      source: 'error',
      reason: `No available model found within allowedTiers [${allowedTiers.join(', ')}]${allowedVendors ? ` and allowedVendors [${allowedVendors.join(', ')}]` : ''} for agent "${agentName}"`,
    };
  }

  // Priority 3: hardcoded default — safety net for agents with no constraints.
  return {
    modelId: DEFAULT_MODEL,
    providerId: DEFAULT_PROVIDER,
    source: 'default',
    reason: 'No routing constraints declared; using hardcoded default',
  };
}
