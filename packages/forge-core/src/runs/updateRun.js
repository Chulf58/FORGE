// updateRun.js — Patch a run and sync its index entry

import { Run } from './schemas.js';
import { runPath, readJson, writeJson } from './storage.js';

/**
 * Applies a partial update to a run. Re-validates the full object after patching.
 *
 * Array/map fields with semantic identity merge by key rather than wholesale-
 * replace: `agents` by `agentId`, `stages` by stage name (with forward-only
 * status guard for completed/skipped), `phases` by `index`. Other fields use
 * shallow replace as before.
 *
 * Closes TODO `91e8d935` / `c0892830` / `0e05f1ab` — direct callers of this
 * function (e.g. `hooks/subagent-stop.js`) bypass the MCP handler in
 * `mcp/server.js`, which previously was the only place doing merge-by-key.
 * Without merge here, callers that passed a partial agents snapshot caused
 * the wholesale-replace to wipe earlier records, producing phantom audit
 * trails (e.g. documenter agent missing from `run.agents` even though it ran).
 *
 * @param {string} projectRoot
 * @param {string} runId
 * @param {object} patch - partial Run fields to merge
 * @returns {object} the updated, validated Run object
 * @throws {Error} if the run doesn't exist
 */
export function updateRun(projectRoot, runId, patch) {
  const filePath = runPath(projectRoot, runId);
  const raw = readJson(filePath);
  if (!raw) {
    throw new Error('Run not found: ' + runId);
  }

  const now = new Date().toISOString();
  const merged = { ...raw, ...patch, updatedAt: now };

  // Agents merge — by agentId. Last-write-wins on collision; existing records
  // whose agentId is not in the patch are preserved unchanged.
  if (patch.agents !== undefined) {
    const existing = Array.isArray(raw.agents) ? raw.agents : [];
    const map = new Map();
    for (const entry of existing) map.set(entry.agentId, entry);
    for (const entry of patch.agents) {
      const prev = map.get(entry.agentId);
      map.set(entry.agentId, prev ? { ...prev, ...entry } : entry);
    }
    merged.agents = Array.from(map.values());
  }

  // Stages merge — by stage name. Forward-only status guard: a stage already
  // at 'completed' or 'skipped' cannot transition back; other fields still
  // merge.
  if (patch.stages !== undefined) {
    const existing = (raw.stages && typeof raw.stages === 'object') ? raw.stages : {};
    const terminal = new Set(['completed', 'skipped']);
    const out = { ...existing };
    for (const [key, incoming] of Object.entries(patch.stages)) {
      const prev = out[key];
      if (prev && terminal.has(prev.status) && incoming.status && incoming.status !== prev.status) {
        out[key] = { ...prev, ...incoming, status: prev.status };
      } else {
        out[key] = prev ? { ...prev, ...incoming } : incoming;
      }
    }
    merged.stages = out;
  }

  // Phases merge — by index. Last-write-wins on collision; result sorted by index.
  // Sentinel: patch.phases === null clears the entire phases array. Used by
  // forge_advance_stage so a new stage's phases don't collide by-index with the
  // prior stage's (TODO: observer 6/6 surfaced because plan-stage Phase A/B/C
  // and implement-stage Phase 1/2/3 both want index 0).
  if (patch.phases !== undefined) {
    if (patch.phases === null) {
      merged.phases = [];
    } else {
      const existing = Array.isArray(raw.phases) ? raw.phases : [];
      const map = new Map();
      for (const entry of existing) map.set(entry.index, entry);
      for (const entry of patch.phases) {
        const prev = map.get(entry.index);
        map.set(entry.index, prev ? { ...prev, ...entry } : entry);
      }
      merged.phases = Array.from(map.values()).sort((a, b) => a.index - b.index);
    }
  }

  const run = Run.parse(merged);

  writeJson(filePath, run);

  return run;
}
