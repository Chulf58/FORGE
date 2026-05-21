import { z } from 'zod';
import { join } from 'node:path';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync as childExecFileSync } from 'node:child_process';
import {
  runIdSchema,
  resolveProjectDir,
  readJsonSafe,
  writeJsonSafe,
  errorResult,
  textResult,
  requirePipeline,
  hasGateApprovalToken,
} from './shared.js';
import { getRun, listRuns, updateRun, getRunActivePath } from '../../../packages/forge-core/src/runs/index.js';

/**
 * Checks opt-in gate preconditions for forge_set_gate.
 * All checks default off — behavior is unchanged unless the relevant env
 * toggle is set to 'on'.
 *
 * @param {string} gate        - 'gate1' | 'gate2' | 'commit'
 * @param {string} status      - gate status being written; non-'pending' → ok:true (guard)
 * @param {object} runData     - { worktreePath, projectRoot, agents, createdAt }
 * @param {object} [overrides] - { env, execFileSync } — injectable for testing
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function checkGatePreconditions(gate, status, runData, overrides = {}) {
  // Guard: skip precondition logic for any status other than 'pending'.
  if (status !== 'pending') return { ok: true };

  const env = overrides.env ?? process.env;
  const { worktreePath, projectRoot, agents = [], createdAt } = runData;

  // Resolve reviewer-output dir path.
  // worktreePath non-null → use worktree path; null → use projectRoot.
  // A set-but-missing dir is treated as empty (not an error).
  const reviewerOutputDir = worktreePath != null
    ? join(worktreePath, '.pipeline', 'context', 'reviewer-output')
    : join(projectRoot, '.pipeline', 'context', 'reviewer-output');

  function hasReviewerOutput() {
    try { return readdirSync(reviewerOutputDir).length > 0; } catch (_) { return false; }
  }

  // ---- gate1: require reviewers to have run ---------------------------------
  if (gate === 'gate1') {
    if (env.FORGE_GATE_PRECONDITION_GATE1 !== 'on') return { ok: true };

    const hasReviewerAgent = agents.some(
      a => typeof a.agentType === 'string' && a.agentType.startsWith('reviewer-'),
    );
    if (hasReviewerOutput() || hasReviewerAgent) return { ok: true };

    return {
      ok: false,
      message: 'Gate 1 requires at least one reviewer to have run. ' +
               'No reviewer output files found and no reviewer agent in the pipeline trail.',
    };
  }

  // ---- gate2: require implementation to be present -------------------------
  if (gate === 'gate2') {
    if (env.FORGE_GATE_PRECONDITION_GATE2 !== 'on') return { ok: true };

    // Condition 1: handoff.md exists (coder output)
    const handoffPath = worktreePath != null
      ? join(worktreePath, 'docs', 'context', 'handoff.md')
      : join(projectRoot, 'docs', 'context', 'handoff.md');
    if (existsSync(handoffPath)) return { ok: true };

    // Condition 2: coder/debug/refactor agent with completed or partial outcome
    const hasImplementer = agents.some(
      a => (a.agentType === 'coder' || a.agentType === 'debug' || a.agentType === 'refactor') &&
           (a.outcome === 'completed' || a.outcome === 'partial'),
    );
    if (hasImplementer) return { ok: true };

    // Condition 3: reviewer-output has files (reviewers already ran)
    if (hasReviewerOutput()) return { ok: true };

    return {
      ok: false,
      message: 'Gate 2 requires implementation to be complete. ' +
               'Missing handoff.md, no coder/debug/refactor agent completed, ' +
               'and no reviewer output found.',
    };
  }

  // ---- commit gate: require documenter or apply commit ----------------------
  if (gate === 'commit') {
    if (env.FORGE_GATE_PRECONDITION_COMMIT !== 'on') return { ok: true };

    // Condition 1: documenter in agents trail
    const hasDocumenter = agents.some(a => a.agentType === 'documenter');
    if (hasDocumenter) return { ok: true };

    // Condition 2: git log — has a feat(forge): commit since run.createdAt.
    // Uses execFileSync with an args ARRAY only — no shell string interpolation.
    // Fails-open on any error (git unavailable, invalid path, etc.).
    const execFileSyncFn = overrides.execFileSync ?? childExecFileSync;
    try {
      const gitBinary = process.platform === 'win32' ? 'git.exe' : 'git';
      const cwd = worktreePath ?? projectRoot;
      const gitArgs = ['log', '--oneline', '--format=%s'];
      if (createdAt) gitArgs.push(`--after=${createdAt}`);
      const output = execFileSyncFn(gitBinary, gitArgs, { cwd, encoding: 'utf8' });
      if (typeof output === 'string' && output.includes('feat(forge):')) return { ok: true };
    } catch (_) {
      // Git unavailable or error → fail-open (treat precondition as satisfied)
      return { ok: true };
    }

    return {
      ok: false,
      message: 'Commit gate requires a documenter agent or apply commit. ' +
               'No documenter found in pipeline trail and no feat(forge): ' +
               'commit found since run was created.',
    };
  }

  // Unknown gate — don't block
  return { ok: true };
}

export function register(server, _shared) {

  // -- Tool: forge_get_active_run ----------------------------------------------

  server.registerTool(
    'forge_get_active_run',
    {
      title: 'FORGE Get Active Run',
      description: 'Returns the current active pipeline run state, or null if no run is active. When runId is provided, returns that run\'s per-run active file directly.',
      inputSchema: z.object({
        runId: runIdSchema.optional().describe('When provided, reads that run\'s per-run active file (.pipeline/runs/<runId>/run-active.json) and returns it directly.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ runId } = {}) => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        // When runId provided: read per-run file directly, no fallback to singleton.
        if (runId) {
          let perRunPath;
          try {
            perRunPath = getRunActivePath(projectDir, runId);
          } catch (pathErr) {
            return errorResult('Invalid runId: ' + pathErr.message);
          }
          if (!existsSync(perRunPath)) {
            return textResult(null);
          }
          const read = readJsonSafe(perRunPath);
          if (!read.ok) return errorResult('Failed to read per-run active file: ' + read.error);
          return textResult(read.data);
        }

        // No runId: read singleton to discover currentRunId, then prefer per-run file.
        const singletonPath = join(check.pipelineDir, 'run-active.json');
        if (!existsSync(singletonPath)) {
          return textResult(null);
        }

        const singletonRead = readJsonSafe(singletonPath);
        if (!singletonRead.ok) return errorResult('Failed to read run-active.json: ' + singletonRead.error);

        const singletonData = singletonRead.data;
        const currentRunId = singletonData && typeof singletonData.runId === 'string' ? singletonData.runId : null;

        // If we have a valid runId from the singleton, prefer the per-run file when present.
        if (currentRunId) {
          try {
            const perRunPath = getRunActivePath(projectDir, currentRunId);
            if (existsSync(perRunPath)) {
              const perRunRead = readJsonSafe(perRunPath);
              if (perRunRead.ok) return textResult(perRunRead.data);
            }
          } catch (_) {
            // Invalid runId stored in singleton — fall through to singleton data
          }
        }

        // Fall back to singleton data (per-run file absent or runId missing/invalid).
        return textResult(singletonData);
      } catch (err) {
        return errorResult('Failed to read active run: ' + err.message);
      }
    },
  );

  // -- Tool: forge_check_gate --------------------------------------------------

  server.registerTool(
    'forge_check_gate',
    {
      title: 'FORGE Check Gate',
      description: 'Returns the current pending gate state (gate1 or gate2), or null if no gate is pending. Pass runId to target a specific run\'s gate file instead of the shared main-root file.',
      inputSchema: z.object({
        runId: runIdSchema.optional().describe('Target a specific run\'s gate file. When omitted, returns the main-root gate (legacy behavior).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ runId }) => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        // When runId is provided, look up that run's gate file directly —
        // avoids the singleton race where parallel runs overwrite each other.
        if (runId) {
          const targetRun = getRun(projectDir, runId);
          if (targetRun && targetRun.worktreePath) {
            const wtGatePath = join(targetRun.worktreePath, '.pipeline', 'gate-pending.json');
            if (existsSync(wtGatePath)) {
              const wtRead = readJsonSafe(wtGatePath);
              if (wtRead.ok) return textResult(wtRead.data);
            }
          }
          // Fall back to main-root file filtered by runId
          const mainGatePath = join(check.pipelineDir, 'gate-pending.json');
          if (existsSync(mainGatePath)) {
            const read = readJsonSafe(mainGatePath);
            if (read.ok && read.data && read.data.runId === runId) return textResult(read.data);
          }
          return textResult(null);
        }

        // Legacy path: no runId — read main-root gate file
        const mainGatePath = join(check.pipelineDir, 'gate-pending.json');
        let mainGate = null;
        if (existsSync(mainGatePath)) {
          const read = readJsonSafe(mainGatePath);
          if (read.ok) mainGate = read.data;
        }

        // Check worktree-backed runs for a gate file the main root may not have.
        // Workers write gate-pending.json to their worktree path; forge_set_gate
        // dual-writes but direct writes bypass it entirely.
        let worktreeGate = null;
        try {
          let candidates = listRuns(projectDir, { status: 'gate-pending' });
          if (!candidates.length) {
            // Also check running runs — gate may have just been written
            candidates = listRuns(projectDir, {}).filter(
              r => r.status === 'running',
            );
          }
          const sorted = candidates.sort(
            (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
          );
          // Only check the first few to avoid performance issues on large run sets
          const limit = Math.min(sorted.length, 5);
          for (let i = 0; i < limit; i++) {
            const run = getRun(projectDir, sorted[i].runId);
            if (run && run.worktreePath) {
              const wtGatePath = join(run.worktreePath, '.pipeline', 'gate-pending.json');
              if (existsSync(wtGatePath)) {
                const wtRead = readJsonSafe(wtGatePath);
                if (wtRead.ok) {
                  worktreeGate = wtRead.data;
                  break;
                }
              }
            }
          }
        } catch (_) {
          // Run lookup failure — proceed with mainGate only
        }

        // Prefer worktree gate when main root is empty or stale
        const result = worktreeGate || mainGate;
        return textResult(result);
      } catch (err) {
        return errorResult('Failed to check gate: ' + err.message);
      }
    },
  );

  // -- Tool: forge_set_gate ----------------------------------------------------
  // Compatibility wrapper: writes gate-pending.json AND syncs the run registry.
  // This ensures run state stays truthful even when the model uses the legacy gate
  // tool instead of calling forge_update_run directly.

  server.registerTool(
    'forge_set_gate',
    {
      title: 'FORGE Set Gate',
      description: 'Creates or updates a pending gate (gate1, gate2, or commit). Also syncs run registry automatically.',
      inputSchema: z.object({
        gate: z.enum(['gate1', 'gate2', 'commit']).describe('Which gate'),
        feature: z.string().describe('Feature name'),
        status: z.enum(['pending', 'approved']).default('pending').describe('Gate status'),
        runId: runIdSchema.optional().describe('Run ID this gate belongs to. If omitted, the tool resolves it by status.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ gate, feature, status, runId }) => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        // Gate self-approval guard: "approved" requires a valid approval token
        if (status === 'approved') {
          if (!hasGateApprovalToken(projectDir)) {
            return errorResult(
              'FORGE: Gate approval requires explicit user authorization. ' +
              'The user must invoke /forge:approve or include \'approve\' in their message ' +
              'before gate status can be set to \'approved\'. ' +
              'This prevents model self-approval of pipeline gates.',
            );
          }
        }

        const now = new Date().toISOString();
        // gatePath resolved after runId is determined (worktree-aware — see below)

        // On approval, preserve the original pending gate's createdAt AND runId.
        // Read the main-root gate file first for the preserved fields.
        let originalCreatedAt = now;
        let resolvedRunId = runId || null;
        if (status === 'approved') {
          const existing = readJsonSafe(join(check.pipelineDir, 'gate-pending.json'));
          if (existing.ok && existing.data) {
            if (existing.data.createdAt) originalCreatedAt = existing.data.createdAt;
            if (!resolvedRunId && existing.data.runId) resolvedRunId = existing.data.runId;
          }
        }

        // If no explicit runId, resolve by status (same heuristic as before, kept
        // as fallback so the field is populated even when callers don't pass it).
        if (!resolvedRunId) {
          const candidates = status === 'approved'
            ? listRuns(projectDir, { status: 'gate-pending' })
            : listRuns(projectDir, {}).filter(r => r.status === 'running' || r.status === 'created');
          const best = candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
          if (best) resolvedRunId = best.runId;
        }

        // Resolve target run once — used for precondition checks and worktree-aware
        // gate path resolution below. Failures are silent; never block on lookup errors.
        let _targetRun = null;
        if (resolvedRunId) {
          try { _targetRun = getRun(projectDir, resolvedRunId); } catch (_) {}
        }

        // --- Gate precondition check (opt-in; all toggles default off) -------
        // checkGatePreconditions returns ok:true immediately when the relevant
        // env toggle is absent (default behavior unchanged). When a toggle is
        // on and the precondition fails, it returns { ok: false, message } and
        // the gate write is rejected.  The helper itself guards non-pending
        // statuses with an early return so approved/discarded paths are unaffected.
        const _precondResult = checkGatePreconditions(gate, status, {
          worktreePath: _targetRun?.worktreePath ?? null,
          projectRoot: projectDir,
          agents: _targetRun?.agents ?? [],
          createdAt: _targetRun?.createdAt ?? null,
        });
        if (!_precondResult.ok) return errorResult(_precondResult.message);

        // Worktree-aware gate path resolution: for worktree-backed runs
        // (implement/debug/refactor), the worker polls
        // <worktreePath>/.pipeline/gate-pending.json. Default to main project root.
        // Gate path components are assembled via path.join from known bases only —
        // no user-controlled strings reach the filesystem call.
        let gatePath = join(check.pipelineDir, 'gate-pending.json');
        if (_targetRun && _targetRun.worktreePath) {
          const wtPipelineDir = join(_targetRun.worktreePath, '.pipeline');
          if (existsSync(wtPipelineDir)) {
            gatePath = join(wtPipelineDir, 'gate-pending.json');
          }
        }

        const data = { gate, feature, status, createdAt: originalCreatedAt };
        if (resolvedRunId) data.runId = resolvedRunId;
        if (status === 'approved') {
          data.approvedAt = now;
        }

        // Write to the authoritative location (worktree or main root)
        writeJsonSafe(gatePath, data);

        // Also write a copy to main project root so forge_check_gate always finds
        // the gate regardless of whether a worktree is involved. No-op when
        // gatePath is already the main root path.
        const mainGatePath = join(check.pipelineDir, 'gate-pending.json');
        if (gatePath !== mainGatePath) {
          writeJsonSafe(mainGatePath, data);
        }

        // Consume the approval token after successful gate approval to prevent
        // replay attacks — one user "approve" authorizes exactly one gate.
        if (status === 'approved') {
          try { unlinkSync(join(check.pipelineDir, 'action-approved.json')); } catch (_) { /* already gone */ }
        }

        // --- Run registry sync (best-effort — never blocks the gate operation) ---
        // Uses resolvedRunId (from explicit input, preserved gate file, or fallback)
        // as the deterministic pointer to the target run.
        try {
          if (status === 'pending' && resolvedRunId) {
            updateRun(projectDir, resolvedRunId, {
              status: 'gate-pending',
              gateState: { gate, status: 'pending', feature, createdAt: now, approvedAt: null },
            });
          } else if (status === 'approved' && resolvedRunId) {
            // Preserve the gate's original pending createdAt from the run's gateState if present
            const existingRun = getRun(projectDir, resolvedRunId);
            const gateCreatedAt = (existingRun && existingRun.gateState && existingRun.gateState.createdAt)
              || originalCreatedAt;
            updateRun(projectDir, resolvedRunId, {
              gateState: { gate, status: 'approved', feature, createdAt: gateCreatedAt, approvedAt: now },
            });
          }
        } catch (_syncErr) {
          // Run registry sync is best-effort — log but don't fail the gate operation
          console.error('[forge_set_gate] run registry sync failed: ' + _syncErr.message);
        }

        // Clear gate-pending.json after a commit gate is approved — the file has
        // served its purpose once the run registry is updated to "completed".
        // gate1/gate2 approvals are intentionally NOT cleared here because the
        // approve skill (Step 2) and the apply skill (Step 1a) re-read the file
        // to resolve the runId and verify the gate before spawning the next stage.
        // Only the commit gate is terminal — nothing reads the file afterwards.
        if (status === 'approved' && gate === 'commit') {
          try { unlinkSync(gatePath); } catch (_) { /* already gone */ }
          // Also clear the main-root copy when a worktree-backed path was the primary.
          if (gatePath !== mainGatePath) {
            try { unlinkSync(mainGatePath); } catch (_) { /* already gone */ }
          }
        }

        return textResult(data);
      } catch (err) {
        return errorResult('Failed to set gate: ' + err.message);
      }
    },
  );

}
