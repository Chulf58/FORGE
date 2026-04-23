'use strict';

// gate-sync.js — PostToolUse hook for Write/Edit on gate-pending.json
//
// When the model writes .pipeline/gate-pending.json directly (bypassing MCP tools),
// this hook reads the file content and syncs the run registry.
//
// Covered transitions:
//   status: "pending"  → finds most recent running/created run → sets gate-pending
//   status: "approved" → finds most recent gate-pending run → sets completed
//   file deleted/empty → finds most recent gate-pending run → sets discarded
//
// Best-effort: never blocks the Write/Edit, never exits non-zero.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, resolvePluginRoot, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

function exitOk() { process.exit(0); }

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { exitOk(); return; }

  const toolName = payload.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') { exitOk(); return; }

  const filePath = (payload.tool_input && (payload.tool_input.file_path || payload.tool_input.path)) || '';
  if (!filePath) { exitOk(); return; }

  // Only act on gate-pending.json
  const normalized = filePath.replace(/\\/g, '/');
  if (!normalized.endsWith('.pipeline/gate-pending.json')) { exitOk(); return; }

  // Resolve project root from validated hook cwd — never from the file path,
  // which could be attacker-controlled via a crafted tool_input.file_path.
  const projectRoot = resolveProjectDir(payload);

  // Read the gate file that was just written
  let gateData = null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    gateData = JSON.parse(raw);
  } catch (_) {
    // File empty, deleted, or malformed — treat as discard
  }

  // Import run registry functions (ESM modules loaded dynamically)
  let createRun, getRun, listRuns, updateRun, createWorktree;
  try {
    // Resolve the core package relative to the plugin root
    const pluginRoot = resolvePluginRoot();
    const coreIndex = path.join(pluginRoot, 'packages', 'forge-core', 'src', 'runs', 'index.js');
    const coreMod = await import('file:///' + coreIndex.replace(/\\/g, '/'));
    createRun = coreMod.createRun;
    getRun = coreMod.getRun;
    listRuns = coreMod.listRuns;
    updateRun = coreMod.updateRun;
    createWorktree = coreMod.createWorktree;
  } catch (err) {
    // Core module not available — can't sync, exit silently
    console.error('[gate-sync] Failed to load core module: ' + err.message);
    exitOk();
    return;
  }

  const now = new Date().toISOString();

  try {
    if (gateData && gateData.status === 'pending') {
      const gateFeature = (gateData.feature || '').toLowerCase().trim();
      let active = null;

      // Prefer explicit runId from the gate file — deterministic O(1) targeting.
      // Falls back to feature-match heuristic when runId is absent (legacy gates).
      if (gateData.runId) {
        const explicit = getRun(projectRoot, gateData.runId);
        if (explicit) {
          active = { runId: gateData.runId };
        }
      }

      // Fallback: find the most recent running/created run that matches this feature.
      // Match rule: the run's feature must contain the gate feature or vice versa
      // (handles "Price alert feature" vs "Price alert feature — notify when...")
      // If no feature match, do not attach to a stale unrelated run.
      if (!active) {
        const allRuns = listRuns(projectRoot, {});
        active = allRuns
          .filter(r => {
            if (r.status !== 'running' && r.status !== 'created') return false;
            if (!gateFeature) return true; // no feature to match — accept any
            const runFeature = (r.feature || '').toLowerCase().trim();
            if (!runFeature) return true; // run has no feature — accept (it was auto-created)
            return runFeature.includes(gateFeature) || gateFeature.includes(runFeature);
          })
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      }

      // If no matching run exists, auto-create one from the gate data
      if (!active) {
        const gate = gateData.gate || 'gate1';
        const pipelineType = gate === 'gate1' ? 'plan' : gate === 'gate2' ? 'implement' : 'plan';
        const run = createRun({
          projectRoot,
          sessionId: payload.session_id || 'auto',
          pipelineType,
          mode: 'LEAN',
          feature: gateData.feature || '',
        });
        // createRun returns status 'created', update to running first
        updateRun(projectRoot, run.runId, { status: 'running', currentStep: 'auto-created' });
        active = { runId: run.runId };
        console.error('[gate-sync] Auto-created run ' + run.runId + ' for ' + pipelineType);
      }

      // Canonical feature identity: use run.feature (authoritative), not gateData.feature.
      // gate-pending.json may have been written by a skill with a paraphrased feature
      // from PLAN.md; the run registry holds the canonical value from forge_create_run.
      const canonicalRun = getRun(projectRoot, active.runId);
      const canonicalFeature = (canonicalRun && canonicalRun.feature) || gateData.feature || '';

      updateRun(projectRoot, active.runId, {
        status: 'gate-pending',
        currentStep: gateData.gate || 'gate',
        gateState: {
          gate: gateData.gate || 'gate1',
          status: 'pending',
          feature: canonicalFeature,
          createdAt: gateData.createdAt || now,
          approvedAt: null,
        },
      });
      console.error('[gate-sync] Run ' + active.runId + ' → gate-pending');

      // Repair gate-pending.json on disk:
      // 1. Stamp runId if missing (makes it a deterministic current-gate pointer)
      // 2. Correct feature drift if the skill wrote a paraphrased name
      const needsRunIdStamp = !gateData.runId;
      const needsFeatureRepair = canonicalFeature && gateData.feature !== canonicalFeature;
      if (needsRunIdStamp || needsFeatureRepair) {
        try {
          const repaired = { ...gateData, runId: active.runId };
          if (needsFeatureRepair) repaired.feature = canonicalFeature;
          fs.writeFileSync(filePath, JSON.stringify(repaired, null, 2) + '\n', 'utf-8');
          const actions = [];
          if (needsRunIdStamp) actions.push('stamped runId=' + active.runId);
          if (needsFeatureRepair) actions.push('feature drift "' + gateData.feature + '" → "' + canonicalFeature + '"');
          console.error('[gate-sync] Repaired gate-pending.json: ' + actions.join(', '));
        } catch (repairErr) {
          console.error('[gate-sync] Failed to repair gate file: ' + repairErr.message);
        }
      }

      // -- Worktree reconciliation for implement runs -------------------------
      // When gate2 fires, the implement phase (coder + reviewers) is done and
      // apply is next. The apply phase (implementer) edits source files — it
      // needs a worktree for branch isolation. If the model skipped
      // forge_create_worktree, auto-create one now.
      //
      // createWorktree copies docs/ and .pipeline/ into the worktree, so the
      // coder's handoff.md (written in the main tree) lands in the worktree
      // automatically. The implementer can then read it from the worktree.
      if ((gateData.gate || 'gate1') === 'gate2') {
        try {
          const currentRun = getRun(projectRoot, active.runId);
          if (currentRun && !currentRun.worktreePath) {
            const updated = createWorktree(projectRoot, active.runId);
            console.error('[gate-sync] Auto-created worktree for run ' + active.runId + ' at ' + updated.worktreePath);
          }
        } catch (wtErr) {
          // Non-fatal — log and continue. The apply phase will proceed
          // without worktree isolation. Common causes: not a git repo,
          // worktree directory conflict, or branch name collision.
          console.error('[gate-sync] Worktree auto-create failed: ' + wtErr.message);
        }
      }

    } else if (gateData && gateData.status === 'approved') {
      // Gate approved → prefer runId from gate file if present; else fall back
      // to the most recent gate-pending run by updatedAt.
      let runEntry = null;
      if (gateData.runId) {
        const explicit = getRun(projectRoot, gateData.runId);
        if (explicit) runEntry = { runId: gateData.runId, createdAt: explicit.createdAt };
      }
      if (!runEntry) {
        const pending = listRuns(projectRoot, { status: 'gate-pending' });
        runEntry = pending.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      }
      if (runEntry) {
        // Canonical feature identity: use run.feature from the registry,
        // not gateData.feature (which may have drifted from skill paraphrasing).
        const canonicalRun = getRun(projectRoot, runEntry.runId);
        const canonicalFeature = (canonicalRun && canonicalRun.feature) || gateData.feature || '';

        updateRun(projectRoot, runEntry.runId, {
          status: 'completed',
          currentStep: (gateData.gate || 'gate') + '-approved',
          gateState: {
            gate: gateData.gate || 'gate1',
            status: 'approved',
            feature: canonicalFeature,
            createdAt: gateData.createdAt || runEntry.createdAt,
            approvedAt: gateData.approvedAt || now,
          },
        });
        console.error('[gate-sync] Run ' + runEntry.runId + ' → completed');

        // Repair gate-pending.json on disk: stamp runId if missing, fix feature drift.
        const needsRunIdStamp = !gateData.runId;
        const needsFeatureRepair = canonicalFeature && gateData.feature !== canonicalFeature;
        if (needsRunIdStamp || needsFeatureRepair) {
          try {
            const repaired = { ...gateData, runId: runEntry.runId };
            if (needsFeatureRepair) repaired.feature = canonicalFeature;
            fs.writeFileSync(filePath, JSON.stringify(repaired, null, 2) + '\n', 'utf-8');
            console.error('[gate-sync] Repaired approved gate-pending.json: runId=' + runEntry.runId);
          } catch (repairErr) {
            console.error('[gate-sync] Failed to repair gate file: ' + repairErr.message);
          }
        }
      }
    } else {
      // File empty/malformed/deleted — treat as discard
      const pending = listRuns(projectRoot, { status: 'gate-pending' });
      const run = pending.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (run) {
        updateRun(projectRoot, run.runId, {
          status: 'discarded',
          currentStep: 'discarded',
        });
        console.error('[gate-sync] Run ' + run.runId + ' → discarded');
      }
    }
  } catch (err) {
    console.error('[gate-sync] Run sync failed: ' + err.message);
    // Best-effort — never block
  }

  exitOk();
}

// -- Stdin reader with timeout guard -----------------------------------------
let inputData = '';
const timer = setTimeout(() => {
  main(inputData || '{}').catch(() => process.exit(0));
}, STDIN_TIMEOUT_MS);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => { inputData += line + '\n'; });
rl.on('close', () => {
  clearTimeout(timer);
  main(inputData || '{}').catch(() => process.exit(0));
});
