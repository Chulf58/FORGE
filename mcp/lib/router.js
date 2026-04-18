// router.js — model recommendation engine (ESM, pure function — no I/O)
// The router advises which model to use; it does NOT execute calls or write files.
//
// Routing priority per agent entry:
//   1. preferred  — specific model pin; config error if tier violates allowedTiers
//   2. fallback   — specific model pin; config error if tier violates allowedTiers
//   3. tier-locked catalog scan — when allowedTiers is set; ordered by tier preference
//      then provider priority; fails clearly if no candidate found within allowedTiers
//   4. legacy requiredCapabilities catalog scan — when allowedTiers is absent
//   5. hardcoded default

const COST_TIER_ORDER = { low: 0, medium: 1, high: 2 };
const REASONING_TIER_ORDER = { haiku: 0, sonnet: 1, opus: 2 };

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_PROVIDER = 'anthropic';

/**
 * Returns the recommended model for an agent.
 *
 * @param {string} agentName - agent filename without extension (e.g. 'coder')
 * @param {object} config - parsed forge-config.json object
 * @param {object} usage - parsed usage.json object (or emptyUsage())
 * @param {{ budgetMode?: 'economy'|'standard'|'performance', excludeModels?: string[] }} options
 *   excludeModels: model IDs to skip for this call only (runtime-only, not persisted).
 *   Used for temporary exclusion after transient failures — does not relax capability requirements.
 * @returns {{ modelId: string|null, providerId: string|null, source: 'preferred'|'fallback'|'catalog'|'default'|'error', reason: string }}
 */
export function recommendModel(agentName, config, usage, options = {}) {
  const budgetMode = options.budgetMode || 'standard';
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

  function tierAllowed(modelId) {
    if (!allowedTiers) return true;
    const def = getModelDef(modelId);
    if (!def) return false;
    return allowedTiers.includes(def.reasoningTier);
  }

  function vendorAllowed(modelId) {
    if (!allowedVendors) return true;
    const def = getModelDef(modelId);
    if (!def) return false;
    return allowedVendors.includes(def.providerId);
  }

  // Priority 1: preferred model
  if (agentEntry?.preferred && !excludeModels.includes(agentEntry.preferred)) {
    const prefDef = getModelDef(agentEntry.preferred);
    if (prefDef && allowedTiers && !allowedTiers.includes(prefDef.reasoningTier)) {
      // Model exists in catalog but its tier violates the declared constraint — config error
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

  // Priority 2: fallback model
  if (agentEntry?.fallback && !excludeModels.includes(agentEntry.fallback)) {
    const fbDef = getModelDef(agentEntry.fallback);
    if (fbDef && allowedTiers && !allowedTiers.includes(fbDef.reasoningTier)) {
      // Model exists in catalog but its tier violates the declared constraint — config error
      return {
        modelId: null,
        providerId: null,
        source: 'error',
        reason: `Config error: fallback model "${agentEntry.fallback}" has tier "${fbDef.reasoningTier}" which is not in allowedTiers [${allowedTiers.join(', ')}] for agent "${agentName}"`,
      };
    }
    if (isAvailable(agentEntry.fallback)) {
      return {
        modelId: agentEntry.fallback,
        providerId: providerIdForModel(agentEntry.fallback),
        source: 'fallback',
        reason: 'Preferred model unavailable; using fallback',
      };
    }
  }

  // Priority 3: tier-locked catalog scan (when allowedTiers is declared)
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

    // No valid candidate within allowedTiers — fail clearly, never escalate or degrade
    return {
      modelId: null,
      providerId: null,
      source: 'error',
      reason: `No available model found within allowedTiers [${allowedTiers.join(', ')}]${allowedVendors ? ` and allowedVendors [${allowedVendors.join(', ')}]` : ''} for agent "${agentName}"`,
    };
  }

  // Priority 4: legacy requiredCapabilities catalog scan (no allowedTiers declared)
  const requiredCaps = agentEntry?.requiredCapabilities || [];
  let candidates = (config.models || []).filter(m => {
    if (excludeModels.includes(m.id)) return false;
    if (!isAvailable(m.id)) return false;
    if (requiredCaps.length === 0) return true;
    const modelCaps = m.capabilities || [];
    return requiredCaps.every(cap => modelCaps.includes(cap));
  });

  if (candidates.length > 0) {
    if (budgetMode === 'economy') {
      candidates = candidates.sort(
        (a, b) => (COST_TIER_ORDER[a.costTier] ?? 1) - (COST_TIER_ORDER[b.costTier] ?? 1),
      );
    } else if (budgetMode === 'performance') {
      candidates = candidates.sort(
        (a, b) => (COST_TIER_ORDER[b.costTier] ?? 1) - (COST_TIER_ORDER[a.costTier] ?? 1),
      );
    }
    const chosen = candidates[0];
    return {
      modelId: chosen.id,
      providerId: chosen.providerId,
      source: 'catalog',
      reason: 'Selected from model catalog matching required capabilities (budget mode: ' + budgetMode + ')',
    };
  }

  // Priority 5: absolute default
  return {
    modelId: DEFAULT_MODEL,
    providerId: DEFAULT_PROVIDER,
    source: 'default',
    reason: 'All preferred providers exhausted or unavailable; using hardcoded default',
  };
}
