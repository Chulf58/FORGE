// model-validation.js — pure validators and catalog mutation helpers (ESM, no I/O).
//
// Used by mcp/server.js MCP tool handlers and by unit tests. Keeping the logic
// as pure functions that take (config, params) and return { ok, entry } |
// { ok: false, error } lets tests exercise every branch without spinning up
// the MCP server or touching disk.

// Hardcoded allowlists — extending any of these intentionally requires a
// code change. Prevents typos like "reasonng" or "meduim" from silently
// entering the catalog and breaking routing.
export const MODEL_CAPABILITY_ALLOWLIST = Object.freeze(new Set([
  'reasoning', 'code', 'analysis', 'fast', 'agentic', 'long-context',
]));

export const MODEL_COST_TIERS = Object.freeze(new Set([
  'free', 'low', 'medium', 'high',
]));

export const MODEL_REASONING_TIERS = Object.freeze(new Set([
  'haiku', 'sonnet', 'opus',
]));

export const PRICING_FIELDS = Object.freeze(['input', 'output', 'cached']);

// -- Field-level validators --------------------------------------------------
// Each returns null on success or a human-readable error message on failure.

export function validateId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    return 'id must be a non-empty string';
  }
  return null;
}

export function validateProviderId(providerId, config) {
  if (typeof providerId !== 'string' || providerId.length === 0) {
    return 'providerId must be a non-empty string';
  }
  const providers = Array.isArray(config?.providers) ? config.providers : [];
  if (!providers.some(p => p && p.id === providerId)) {
    const known = providers.map(p => p.id).filter(Boolean).join(', ') || '(none)';
    return `providerId "${providerId}" not found in config.providers — known: ${known}`;
  }
  return null;
}

export function validateCapabilities(caps) {
  if (!Array.isArray(caps) || caps.length === 0) {
    return 'capabilities must be a non-empty array';
  }
  for (const c of caps) {
    if (typeof c !== 'string' || !MODEL_CAPABILITY_ALLOWLIST.has(c)) {
      const allowed = [...MODEL_CAPABILITY_ALLOWLIST].join(', ');
      return `unknown capability "${c}" — allowed: ${allowed}`;
    }
  }
  return null;
}

export function validateCostTier(tier) {
  if (!MODEL_COST_TIERS.has(tier)) {
    return `costTier must be one of: ${[...MODEL_COST_TIERS].join(', ')}`;
  }
  return null;
}

export function validatePricing(pricing) {
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) {
    return 'pricing must be an object with input/output/cached fields';
  }
  for (const key of PRICING_FIELDS) {
    const v = pricing[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return `pricing.${key} must be a non-negative finite number`;
    }
  }
  return null;
}

export function validateReasoningTier(tier) {
  if (tier === undefined || tier === null) return null;
  if (!MODEL_REASONING_TIERS.has(tier)) {
    return `reasoningTier must be one of: ${[...MODEL_REASONING_TIERS].join(', ')}`;
  }
  return null;
}

export function validateContextWindow(cw) {
  if (cw === undefined || cw === null) return null;
  if (!Number.isInteger(cw) || cw <= 0) {
    return 'contextWindow must be a positive integer';
  }
  return null;
}

export function validateNotes(notes) {
  if (notes === undefined || notes === null) return null;
  if (typeof notes !== 'string') return 'notes must be a string';
  return null;
}

// -- Composite operations ----------------------------------------------------
// Mutate the config in place and return the affected entry on success.

/**
 * Validates params and appends a new model entry to config.models.
 * Mutates config in place. Returns { ok: true, entry } on success or
 * { ok: false, error } on any validation failure.
 *
 * Required params: id, providerId, capabilities, costTier, pricing.
 * Optional: contextWindow, reasoningTier, notes.
 *
 * Rejections:
 *   - duplicate id (use updateModelInConfig instead)
 *   - unknown providerId
 *   - capability not in allowlist
 *   - malformed pricing
 *   - unknown costTier / reasoningTier
 *   - non-positive contextWindow
 */
export function addModelToConfig(config, params) {
  let err;
  if ((err = validateId(params.id))) return { ok: false, error: err };
  if ((err = validateProviderId(params.providerId, config))) return { ok: false, error: err };
  if ((err = validateCapabilities(params.capabilities))) return { ok: false, error: err };
  if ((err = validateCostTier(params.costTier))) return { ok: false, error: err };
  if ((err = validatePricing(params.pricing))) return { ok: false, error: err };
  if ((err = validateReasoningTier(params.reasoningTier))) return { ok: false, error: err };
  if ((err = validateContextWindow(params.contextWindow))) return { ok: false, error: err };
  if ((err = validateNotes(params.notes))) return { ok: false, error: err };

  if (!Array.isArray(config.models)) config.models = [];
  if (config.models.some(m => m && m.id === params.id)) {
    return { ok: false, error: `model with id "${params.id}" already exists — use forge_update_model to modify` };
  }

  const entry = {
    id: params.id,
    providerId: params.providerId,
    capabilities: [...params.capabilities],
    costTier: params.costTier,
    pricing: {
      input: params.pricing.input,
      output: params.pricing.output,
      cached: params.pricing.cached,
    },
  };
  if (params.contextWindow !== undefined && params.contextWindow !== null) {
    entry.contextWindow = params.contextWindow;
  }
  if (params.reasoningTier !== undefined && params.reasoningTier !== null) {
    entry.reasoningTier = params.reasoningTier;
  }
  if (params.notes !== undefined && params.notes !== null) {
    entry.notes = params.notes;
  }

  config.models.push(entry);
  return { ok: true, entry };
}

/**
 * Validates touched fields and applies a partial update to an existing model
 * entry identified by params.id. Mutates the config in place. Returns
 * { ok: true, entry } on success or { ok: false, error } on failure.
 *
 * Untouched fields are preserved. The model id itself cannot be changed.
 *
 * Rejections:
 *   - id not found (use addModelToConfig to create)
 *   - any touched field fails its validator
 */
export function updateModelInConfig(config, params) {
  const idErr = validateId(params.id);
  if (idErr) return { ok: false, error: idErr };

  const models = Array.isArray(config.models) ? config.models : [];
  const idx = models.findIndex(m => m && m.id === params.id);
  if (idx === -1) {
    return { ok: false, error: `model with id "${params.id}" not found — use forge_add_model to create it` };
  }

  const entry = models[idx];

  if (params.providerId !== undefined && params.providerId !== null) {
    const err = validateProviderId(params.providerId, config);
    if (err) return { ok: false, error: err };
    entry.providerId = params.providerId;
  }
  if (params.capabilities !== undefined && params.capabilities !== null) {
    const err = validateCapabilities(params.capabilities);
    if (err) return { ok: false, error: err };
    entry.capabilities = [...params.capabilities];
  }
  if (params.costTier !== undefined && params.costTier !== null) {
    const err = validateCostTier(params.costTier);
    if (err) return { ok: false, error: err };
    entry.costTier = params.costTier;
  }
  if (params.pricing !== undefined && params.pricing !== null) {
    const err = validatePricing(params.pricing);
    if (err) return { ok: false, error: err };
    entry.pricing = {
      input: params.pricing.input,
      output: params.pricing.output,
      cached: params.pricing.cached,
    };
  }
  if (params.contextWindow !== undefined && params.contextWindow !== null) {
    const err = validateContextWindow(params.contextWindow);
    if (err) return { ok: false, error: err };
    entry.contextWindow = params.contextWindow;
  }
  if (params.reasoningTier !== undefined && params.reasoningTier !== null) {
    const err = validateReasoningTier(params.reasoningTier);
    if (err) return { ok: false, error: err };
    entry.reasoningTier = params.reasoningTier;
  }
  if (params.notes !== undefined && params.notes !== null) {
    const err = validateNotes(params.notes);
    if (err) return { ok: false, error: err };
    entry.notes = params.notes;
  }

  return { ok: true, entry };
}
