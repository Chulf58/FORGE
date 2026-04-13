// router.js — model recommendation engine (ESM, pure function — no I/O)
// The router advises which model to use; it does NOT execute calls or write files.

const COST_TIER_ORDER = { low: 0, medium: 1, high: 2 };

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_PROVIDER = 'anthropic';

/**
 * Returns the recommended model for an agent.
 *
 * @param {string} agentName - agent filename without extension (e.g. 'coder')
 * @param {object} config - parsed forge-config.json object
 * @param {object} usage - parsed usage.json object (or emptyUsage())
 * @param {{ budgetMode?: 'economy'|'standard'|'performance' }} options
 * @returns {{ modelId: string, providerId: string, source: 'preferred'|'fallback'|'catalog'|'default', reason: string }}
 */
export function recommendModel(agentName, config, usage, options = {}) {
  const budgetMode = options.budgetMode || 'standard';
  const agentEntry = config.agentModelMap?.[agentName];

  // Helper: check if a model's provider is enabled and not quota-exhausted.
  function isAvailable(modelId) {
    if (!modelId) return false;

    const modelDef = (config.models || []).find(m => m.id === modelId);
    if (!modelDef) return false; // model not in catalog — skip

    const providerId = modelDef.providerId;
    const providerDef = (config.providers || []).find(p => p.id === providerId);
    if (!providerDef || !providerDef.enabled) return false;

    // Optional chaining guards against a provider not yet in usage state
    const exhausted = usage.providers?.[providerId]?.quotaExhausted ?? false;
    return !exhausted;
  }

  function providerIdForModel(modelId) {
    return (config.models || []).find(m => m.id === modelId)?.providerId ?? null;
  }

  // Priority 1: agent's preferred model
  if (agentEntry && isAvailable(agentEntry.preferred)) {
    return {
      modelId: agentEntry.preferred,
      providerId: providerIdForModel(agentEntry.preferred),
      source: 'preferred',
      reason: 'Agent preferred model is available',
    };
  }

  // Priority 2: agent's fallback model (may be undefined — guard with optional chaining)
  if (agentEntry?.fallback && isAvailable(agentEntry.fallback)) {
    return {
      modelId: agentEntry.fallback,
      providerId: providerIdForModel(agentEntry.fallback),
      source: 'fallback',
      reason: 'Preferred model provider exhausted or unavailable; using fallback',
    };
  }

  // Priority 3: scan catalog for any model matching required capabilities
  const requiredCaps = agentEntry?.requiredCapabilities || [];
  let candidates = (config.models || []).filter(m => {
    if (!isAvailable(m.id)) return false;
    if (requiredCaps.length === 0) return true;
    const modelCaps = m.capabilities || [];
    return requiredCaps.every(cap => modelCaps.includes(cap));
  });

  if (candidates.length > 0) {
    // Apply budget mode sorting (soft preference — not a hard filter)
    if (budgetMode === 'economy') {
      candidates = candidates.sort(
        (a, b) => (COST_TIER_ORDER[a.costTier] ?? 1) - (COST_TIER_ORDER[b.costTier] ?? 1),
      );
    } else if (budgetMode === 'performance') {
      candidates = candidates.sort(
        (a, b) => (COST_TIER_ORDER[b.costTier] ?? 1) - (COST_TIER_ORDER[a.costTier] ?? 1),
      );
    }
    // 'standard' — no sort; use catalog order

    const chosen = candidates[0];
    return {
      modelId: chosen.id,
      providerId: chosen.providerId,
      source: 'catalog',
      reason: 'Selected from model catalog matching required capabilities (budget mode: ' + budgetMode + ')',
    };
  }

  // Priority 4: absolute default
  return {
    modelId: DEFAULT_MODEL,
    providerId: DEFAULT_PROVIDER,
    source: 'default',
    reason: 'All preferred providers exhausted or unavailable; using hardcoded default',
  };
}
