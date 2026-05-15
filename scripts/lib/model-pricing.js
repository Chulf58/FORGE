// @module scripts/lib/model-pricing.js
// Centralised per-model USD pricing table and cost helper.
//
// Rates match scripts/token-usage.mjs:8-12 exactly.
// ESM module — importable from forge-observer.mjs and any other ESM script.

// Per-model pricing: USD per 1M tokens (same rates as scripts/token-usage.mjs)
export const MODEL_PRICING = {
  opus:   { input: 15.0, output: 75.0,  cache_read: 1.50, cache_write: 18.75 },
  sonnet: { input:  3.0, output: 15.0,  cache_read: 0.30, cache_write:  3.75 },
  haiku:  { input:  0.80, output:  4.0, cache_read: 0.08, cache_write:  1.00 },
};

/**
 * Resolve model tier string ('opus' | 'sonnet' | 'haiku') from a model ID.
 * Accepts full model IDs like 'claude-opus-4-6', 'claude-sonnet-4-5', etc.
 * @param {string|null|undefined} modelId
 * @returns {'opus'|'sonnet'|'haiku'}
 */
export function modelTier(modelId) {
  if (!modelId) return 'sonnet';
  const m = modelId.toLowerCase();
  if (m.includes('opus'))  return 'opus';
  if (m.includes('haiku')) return 'haiku';
  return 'sonnet';
}

/**
 * Estimate USD cost from token counts and a model ID.
 *
 * @param {number|{input_tokens?: number, output_tokens?: number, cache_read_input_tokens?: number, cache_creation_input_tokens?: number}} tokens
 *   - When a number: treated as total tokens billed at the input rate (blended estimate).
 *   - When an object: uses the full breakdown matching usage.json shape for exact cost.
 * @param {string} modelId  Full model ID string (e.g. 'claude-sonnet-4-5-20251001').
 * @returns {number}  Estimated USD cost (may be 0 for zero token counts).
 */
export function estimateCost(tokens, modelId) {
  const tier = modelTier(modelId);
  const p = MODEL_PRICING[tier];

  if (typeof tokens === 'number') {
    // Simple total — bill at input rate as a conservative blended estimate.
    return (tokens / 1e6) * p.input;
  }

  // Detailed usage object — mirrors the msgCost calculation in token-usage.mjs.
  const inp  = tokens.input_tokens                 || 0;
  const out  = tokens.output_tokens                || 0;
  const cr   = tokens.cache_read_input_tokens      || 0;
  const cw   = tokens.cache_creation_input_tokens  || 0;

  return (inp / 1e6) * p.input
       + (out / 1e6) * p.output
       + (cr  / 1e6) * p.cache_read
       + (cw  / 1e6) * p.cache_write;
}
