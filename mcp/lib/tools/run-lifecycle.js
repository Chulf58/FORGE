import { z } from 'zod';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
  renameSync,
  rmSync,
  openSync,
  closeSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  runIdSchema,
  runIdOrBareSchema,
  resolveProjectDir,
  resolveMainProjectDir,
  writeJsonSafe,
  errorResult,
  textResult,
  requirePipeline,
  hasGateApprovalToken,
  pathsEqual,
} from './shared.js';
import {
  createRun,
  getRun,
  listRuns,
  updateRun,
  createWorktree,
  removeWorktree,
  rebuildIndex,
  getRunActivePath,
  writeRunActive,
} from '../../../packages/forge-core/src/runs/index.js';
import { buildDashboardState } from '../dashboard-state.js';
import { sanitizeFeatureName } from '../sanitize.js';
import { workerLogPath, killPillPath } from '../worker-paths.js';
import { sweepStalePids } from '../worker-pids.js';
import { wantsWorktree } from '../worktree-intent.mjs';

// -- Run pruning -------------------------------------------------------------

const MAX_TERMINAL_RUNS = 10;
const PRUNE_STATUSES = new Set(['completed', 'failed', 'discarded']);

function pruneTerminalRuns(projectDir) {
  try {
    const all = listRuns(projectDir);
    const terminal = all
      .filter(e => PRUNE_STATUSES.has(e.status))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    if (terminal.length <= MAX_TERMINAL_RUNS) return;

    const toPrune = terminal.slice(MAX_TERMINAL_RUNS);
    const runsBase = join(projectDir, '.pipeline', 'runs');

    for (const entry of toPrune) {
      // Clean up the git worktree first, before deleting the run directory.
      // The run.json (which holds worktreePath) lives inside the run dir —
      // we must read it before rmSync obliterates it.
      try {
        const run = getRun(projectDir, entry.runId);
        if (run) {
          removeWorktree(projectDir, entry.runId, run.worktreePath || null);
        }
      } catch (_) {}

      const dir = join(runsBase, entry.runId);
      try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }

    rebuildIndex(projectDir);
    console.error('[forge] pruned ' + toPrune.length + ' old runs, kept ' + MAX_TERMINAL_RUNS);
  } catch (err) {
    console.error('[forge] prune failed: ' + err.message);
  }
}

// -- Classification cache ----------------------------------------------------

// In-process cache of classification results — keyed by classificationId.
// Survives the lifetime of the MCP server process; not persisted to disk.
// No TTL — entries are small (< 1 KB each). Cap at 500 entries: when the limit
// is reached the oldest entry is evicted before inserting the new one. This
// prevents unbounded growth in long-running MCP server processes.
const classificationCache = new Map();

// Risk classification constants.
// Source of truth: scripts/lean-risk-classify.mjs. Inlined per plan decision (Wave 3 consolidates).
const RISK_PATH_PATTERNS = [
  { pattern: /child_process|spawn|exec/i, rule: 'shell' },
  { pattern: /\.env|credentials|secrets?|auth/i, rule: 'auth' },
  { pattern: /hooks\//i, rule: 'hook' },
  { pattern: /mcp\//i, rule: 'mcp' },
  { pattern: /\/scripts\//i, rule: 'script' },
  { pattern: /schema|contract/i, rule: 'schema' },
  { pattern: /worktree|merge|apply/i, rule: 'merge' },
  { pattern: /server\.|router\.|fetch|http/i, rule: 'network' },
];

const RISK_CONTENT_PATTERNS = [
  { pattern: /child_process|execFile|spawnSync/i, rule: 'shell' },
  { pattern: /writeFile|unlink|rmSync|rmdir/i, rule: 'fs-write' },
  { pattern: /password|secret|token|apiKey|credentials/i, rule: 'auth' },
  { pattern: /process\.env/i, rule: 'env' },
  { pattern: /fetch\(|http\.request|axios/i, rule: 'network' },
  { pattern: /registerTool|server\.tool/i, rule: 'mcp' },
  { pattern: /z\.object|z\.string|RunIndex|RunIndexEntry/i, rule: 'schema' },
  { pattern: /worktreePath|branchName|merge\(/i, rule: 'merge' },
];

const RULE_TO_REVIEWERS = {
  shell:      ['reviewer-safety'],
  'fs-write': ['reviewer-safety'],
  auth:       ['reviewer-safety'],
  env:        ['reviewer-safety'],
  hook:       ['reviewer-safety', 'reviewer-boundary'],
  mcp:        ['reviewer-safety', 'reviewer-boundary'],
  script:     ['reviewer-safety', 'reviewer-boundary'],
  schema:     ['reviewer-boundary'],
  merge:      ['reviewer-safety', 'reviewer-boundary'],
  network:    ['reviewer-safety', 'reviewer-boundary'],
};

// -- Register function -------------------------------------------------------

export function register(server, _shared) {

  // -- Tool: forge_create_run --------------------------------------------------

  server.registerTool(
    'forge_create_run',
    {
      title: 'FORGE Create Run',
      description: 'Creates a new pipeline run. Returns the full run object with a generated runId. When spawnWorker is true, also opens a new terminal tab with an autonomous Claude Code worker session — use this in conductor sessions instead of the Agent tool.',
      inputSchema: z.object({
        sessionId: z.string().describe('Claude session ID'),
        pipelineType: z.string().describe('Pipeline type: plan, implement, apply, debug, refactor, research, explore, ideate'),
        feature: z.string().default('').describe('Feature name or description'),
        spawnWorker: z.boolean().default(false).describe('Spawn an autonomous Claude Code worker in a new terminal tab'),
        useWorktree: z.boolean().default(false).describe('Create an isolated git worktree for the worker (only used when spawnWorker is true)'),
        parentRunId: runIdSchema.optional().describe('Run ID of the originating run, for chained pipelines (e.g. plan → implement)'),
        stages: z.record(z.string(), z.object({
          agents: z.array(z.enum([
            'planner', 'researcher', 'gotcha-checker', 'coder', 'coder-scout',
            'debug', 'refactor', 'completeness-checker', 'implementation-architect',
            'documenter', 'reviewer-safety', 'reviewer-boundary', 'reviewer-logic',
            'reviewer-style', 'reviewer-performance',
          ])).default([]),
          status: z.enum(['pending', 'running', 'completed', 'skipped']).default('pending'),
        })).nullable().optional().describe('Initial stage map — keys are stage names, values are per-stage objects with agents array and status'),
        classificationId: z.string().nullable().optional().describe('Risk classification ID from forge_classify_risk'),
        reviewerOverrides: z.array(z.string()).optional().describe("Explicit reviewer list overriding classification-derived reviewers. Valid values: 'reviewer-safety', 'reviewer-boundary', 'reviewer-logic', 'reviewer-style', 'reviewer-performance'"),
        taskBrief: z.string().optional().describe("Optional long-form briefing injected verbatim into the worker's SessionStart prompt. Use when the short `feature` field cannot carry sufficient detail (research/explore runs with numbered questions, file references, output specs). Capped at 16384 chars; control characters stripped."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ sessionId, pipelineType, feature, spawnWorker, useWorktree, parentRunId, stages, classificationId, reviewerOverrides, taskBrief }) => {
      try {
        const projectDir = resolveProjectDir();
        // Sanitize feature name at ingestion — strips shell-injection chars before
        // the value is stored in run.json or returned to skills for git/PR usage.
        const safeFeature = sanitizeFeatureName(feature);

        // Validate that a plan exists before allowing an implement run.
        // Debug and refactor pipelines have their own entry points and do not require a plan.
        if (pipelineType === 'implement') {
          let planFound = false;
          try {
            const planRuns = listRuns(projectDir, { pipelineType: 'plan' });
            planFound = planRuns.some((entry) => {
              try {
                const planRun = getRun(projectDir, entry.runId);
                return planRun?.gateState?.gate === 'gate1' && planRun?.gateState?.status === 'approved';
              } catch (_) {
                return false;
              }
            });
          } catch (_) {
            // listRuns failure — fall through to PLAN.md check
          }
          if (!planFound) {
            return errorResult('implement pipeline requires a completed plan (gate1 approved). Run /forge:plan first.');
          }
        }

        // Guard: prevent duplicate apply when source worker is still alive.
        // After gate2 approval, the existing worker resumes and handles apply
        // (documenter, lifecycle, commit gate). /forge:apply is manual recovery
        // only — block if the source worker should still be alive.
        if (pipelineType === 'apply') {
          const gatePendingRuns = listRuns(projectDir, { status: 'gate-pending' });
          const aliveSource = gatePendingRuns.find(entry => {
            try {
              const r = getRun(projectDir, entry.runId);
              return r && !r.failureReason
                && r.gateState?.gate === 'gate2'
                && r.gateState?.status === 'approved';
            } catch (_) { return false; }
          });
          if (aliveSource) {
            return errorResult(
              'Apply blocked: source run ' + aliveSource.runId + ' has gate2 approved and should be resuming automatically. '
              + 'Wait for the commit gate. Only use /forge:apply if the worker is confirmed dead (status: failed/discarded).',
            );
          }
        }

        const run = createRun({ projectRoot: projectDir, sessionId, pipelineType, feature: safeFeature, parentRunId: parentRunId ?? null, stages: stages ?? null, classificationId: classificationId ?? null, reviewerOverrides: reviewerOverrides ?? [] });

        // Sweep stale PID files BEFORE flipping status to 'running' — orphan PIDs
        // from prior runs are cleaned up while the new run's status is still 'created',
        // so sweepStalePids' markRunFailed guard (`runData.status === 'running'`) cannot
        // fire against the new run.  Fixes the sweep-after-set race (TODO 9424e08a).
        const mainProjectDir = resolveMainProjectDir();
        const sweepResult = sweepStalePids(mainProjectDir);
        if (sweepResult.swept > 0) {
          console.error('[forge_create_run] sweepStalePids swept ' + sweepResult.swept + ' stale PID(s), alive=' + sweepResult.alive + ', errors=' + sweepResult.errors);
        }

        // Immediately mark as running — the model reliably calls forge_create_run
        // but skips the follow-up forge_update_run to set status: "running".
        const started = updateRun(projectDir, run.runId, { status: 'running' });

        // Initialize run-active.json — the lightweight pipeline marker read by
        // workflow-guard.js (needs startedAt), forge-status.js (needs startedAt +
        // mode), and ctx-stop.js / subagent hooks (need agents array).
        // Overwrite any stale marker from a previous run — each forge_create_run
        // starts a new pipeline, and run-active.json tracks exactly one.
        const runActiveData = {
          startedAt: Date.now(),
          runId: started.runId,
          pipelineType,
          feature: safeFeature,
          agents: [],
        };
        if (started.stages != null) {
          runActiveData.stages = started.stages;
        }

        // For apply runs: resolve the exact worktree from the approved gate2 run.
        // Canonical identity is run.feature (not gate-pending.json.feature, which
        // may drift from skill-side paraphrasing). We find the most recent implement
        // run whose own gateState shows gate2 approved, and use ITS run.feature as
        // the authoritative feature for downstream use.
        if (pipelineType === 'apply') {
          try {
            const implRuns = listRuns(projectDir, { pipelineType: 'implement' })
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            for (const entry of implRuns) {
              const impl = getRun(projectDir, entry.runId);
              if (!impl || !impl.worktreePath) continue;
              if (!existsSync(impl.worktreePath)) continue;
              // Require gate2 approved on the run's own gateState — this is canonical.
              if (!impl.gateState) continue;
              if (impl.gateState.gate !== 'gate2') continue;
              if (impl.gateState.status !== 'approved') continue;
              // Match found — this is the implement run whose gate2 was approved
              // most recently and has a valid worktree on disk.
              runActiveData.worktreePath = impl.worktreePath;
              break;
            }
          } catch (_) {
            // Best-effort — if resolution fails, apply runs without worktree isolation
          }
        }

        // Write per-run active file — sole authoritative source (singleton removed).
        try {
          writeRunActive(projectDir, started.runId, runActiveData);
        } catch (perRunErr) {
          console.error('[forge_create_run] per-run active write failed (non-fatal): ' + perRunErr.message);
        }

        pruneTerminalRuns(projectDir);

        if (!spawnWorker) return textResult(started);

        // Guard: prevent recursive spawning — if this MCP server is running inside
        // a worker process, never spawn another worker. The worker's MCP server is
        // started by mcp/forge-worker.mjs with FORGE_WORKER_SESSION='1' in its env;
        // the conductor's MCP server does not have this var, so its guard never fires.
        // Env-var check is race-free vs. the previous file-system check, which was
        // observed to false-positive when sibling workers' worker-task-<runId>.json
        // files were still on disk before their SessionStart hook consumed them.
        if (process.env.FORGE_WORKER_SESSION === '1') {
          console.error('[forge_create_run] FORGE_WORKER_SESSION is set — skipping spawn (already inside a worker)');
          return textResult(started);
        }

        // Guard: prevent worker collision (AC-11) — narrowed to true conflicts.
        //
        // The new run's intent at this point is captured by `useWorktree`:
        //   - useWorktree === true  → createWorktree() will assign unique paths
        //                             (`.worktrees/<runId>/` and `forge/<runId>`),
        //                             so worktree/branch collisions are impossible.
        //   - useWorktree === false → main-root slot; collides only with other
        //                             main-root running runs in the same project.
        //
        // Predicate (block when ANY existing running run b matches a):
        //   (a.worktreePath && a.worktreePath === b.worktreePath) ||
        //   (a.branchName   && a.branchName   === b.branchName)   ||
        //   (a.worktreePath === null && b.worktreePath === null && a.projectRoot === b.projectRoot)
        // An implement run ALWAYS gets a worktree (wantsWorktree forces it even when the
        // skill passes useWorktree:false), so it routes through the unique-worktree-path
        // branch below, never the main-root slot. Other pipelines opt in via useWorktree.
        const wantWt = wantsWorktree({ pipelineType, useWorktree });
        const runningRuns = listRuns(projectDir, { status: 'running' }).filter(r => r.runId !== started.runId);
        if (!wantWt) {
          // New run will use the main-root slot — block only main-root runs in the same project.
          const conflicts = runningRuns.filter(b => b.worktreePath == null && b.projectRoot === projectDir);
          if (conflicts.length > 0) {
            const conflicting = conflicts.map(r => r.runId).join(', ');
            return errorResult(
              'Worker collision blocked: run(s) ' + conflicting + ' already running in the same main-root slot. Wait for them to finish or mark them failed/discarded before spawning a new worker in the main project root.',
            );
          }
        }
        // useWorktree === true: createWorktree assigns unique worktreePath/branchName per runId — no collision possible.

        // --- Worker spawning (headless) ---
        let workDir = projectDir;
        if (wantWt) {
          // Mirror forge_advance_stage Seam-A (run-lifecycle.js): create the isolated worktree;
          // a non-git environment (e.g. test fixture) falls back to path-only persistence.
          try {
            const wtRun = createWorktree(projectDir, started.runId);
            workDir = wtRun.worktreePath;
          } catch (wtErr) {
            const wtPath = join(projectDir, '.worktrees', started.runId);
            const persisted = updateRun(projectDir, started.runId, { worktreePath: wtPath, branchName: 'forge/' + started.runId });
            workDir = persisted.worktreePath || wtPath;
          }
        }

        const taskDir = join(workDir, '.pipeline');
        if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });
        // Sanitize taskBrief: strip ANSI/null/control chars (preserve \r\n inside the brief), cap at 16KB.
        const sanitizedBrief = taskBrief
          ? String(taskBrief).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, 16384)
          : '';
        const taskFilePath = join(taskDir, 'worker-task-' + started.runId + '.json');
        writeFileSync(
          taskFilePath,
          JSON.stringify({ runId: started.runId, feature: safeFeature, pipelineType, taskBrief: sanitizedBrief, createdAt: new Date().toISOString() }, null, 2) + '\n',
          'utf-8',
        );

        const workerScriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'forge-worker.mjs');
        const workerName = 'worker-' + started.runId;
        const logFile = workerLogPath(projectDir, started.runId);
        const logDir = join(projectDir, '.pipeline', 'worker-logs');
        if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
        const logFd = openSync(logFile, 'a');
        let child;
        try {
          child = nodeSpawn(process.execPath, [workerScriptPath], {
            cwd: workDir,
            detached: process.platform !== 'win32',
            windowsHide: true,
            stdio: ['ignore', logFd, logFd],
            env: { ...process.env, FORGE_WORKER_RUN_ID: started.runId },
          });
          const pidDir = join(projectDir, '.pipeline', 'worker-pids');
          mkdirSync(pidDir, { recursive: true });
          const pidFile = join(pidDir, started.runId + '.json');
          writeJsonSafe(pidFile, { runId: started.runId, pid: child.pid, startedAt: new Date().toISOString() });
          child.on('error', (err) => {
            console.error('[forge_create_run] worker spawn failed: ' + err.message);
            try { unlinkSync(taskFilePath); } catch (_) {}
            try { unlinkSync(pidFile); } catch (_) {}
            // Mark run as failed so conductor can see the spawn failure
            try {
              const runFilePath = join(projectDir, '.pipeline', 'runs', started.runId, 'run.json');
              const raw = readFileSync(runFilePath, 'utf-8');
              const runData = JSON.parse(raw);
              if (runData.status === 'running') {
                runData.status = 'failed';
                runData.failureReason = 'worker spawn error: ' + err.message;
                runData.updatedAt = new Date().toISOString();
                writeJsonSafe(runFilePath, runData);
              }
            } catch (updateErr) {
              console.error('[forge_create_run] error handler failed to update run status: ' + updateErr.message);
            }
          });
          child.on('exit', (code) => {
            try { closeSync(logFd); } catch (_) {}
            try { unlinkSync(pidFile); } catch (_) {}
            try {
              const runFilePath = join(projectDir, '.pipeline', 'runs', started.runId, 'run.json');
              const raw = readFileSync(runFilePath, 'utf-8');
              const runData = JSON.parse(raw);
              if (runData.status === 'running') {
                runData.status = 'failed';
                runData.failureReason = 'worker process exited with code ' + code;
                runData.updatedAt = new Date().toISOString();
                writeJsonSafe(runFilePath, runData);
              }
            } catch (exitErr) {
              console.error('[forge_create_run] exit handler failed to update run status: ' + exitErr.message);
            }
          });
          child.unref();
        } catch (spawnErr) {
          try { closeSync(logFd); } catch (_) {}
          throw spawnErr;
        }

        return textResult({
          ...started,
          workerSpawned: true,
          workerName,
          workDir,
          useWorktree,
          logFile,
          message: 'Worker spawned headlessly: ' + safeFeature,
        });
      } catch (err) {
        return errorResult('forge_create_run failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_get_run -----------------------------------------------------

  server.registerTool(
    'forge_get_run',
    {
      title: 'FORGE Get Run',
      description: 'Returns a single run by ID, or null if not found.',
      inputSchema: z.object({
        runId: runIdSchema.describe('Run ID (e.g. r-a1b2c3d4)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ runId }) => {
      try {
        const projectDir = resolveProjectDir();
        const run = getRun(projectDir, runId);
        // Merge loop-guard sidecar if present — exposes block event data to
        // observer and conductor without modifying run.json (sidecar pattern).
        if (run) {
          const sidecarPath = join(projectDir, '.pipeline', 'runs', runId, 'loop-guard-blocked.json');
          if (existsSync(sidecarPath)) {
            try {
              const raw = readFileSync(sidecarPath, 'utf-8');
              const sidecarData = JSON.parse(raw);
              if (sidecarData && typeof sidecarData.agentType === 'string' && typeof sidecarData.blockedAt === 'string') {
                run.loopGuardEvent = sidecarData;
              }
            } catch (_) { /* malformed sidecar — omit field, don't throw */ }
          }
          // Merge watchdog-stamp sidecar if present — surfaces silent-exit failureReason
          // set by Task 17a (worker-side stamp) to all consumers. Sidecar values do NOT
          // override run.json's non-null failureReason (idempotent — explicit beats implicit).
          const watchdogStampPath = join(projectDir, '.pipeline', 'runs', runId, 'watchdog-stamp.json');
          if (existsSync(watchdogStampPath)) {
            try {
              const raw = readFileSync(watchdogStampPath, 'utf-8');
              const stampData = JSON.parse(raw);
              if (stampData && typeof stampData.failureReason === 'string') {
                // Only merge if run.json doesn't already have an explicit failureReason
                if (!run.failureReason) {
                  run.failureReason = stampData.failureReason;
                }
                if (!run.status || run.status === 'running') {
                  run.status = stampData.status || 'failed';
                }
              }
            } catch (_) { /* malformed sidecar — omit, don't throw */ }
          }
        }
        return textResult(run);
      } catch (err) {
        return errorResult('forge_get_run failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_list_runs ---------------------------------------------------

  server.registerTool(
    'forge_list_runs',
    {
      title: 'FORGE List Runs',
      description: 'Lists runs from the index, optionally filtered and field-projected. Use `filter` for the newer/ergonomic path with array-aware status/pipelineType matching; legacy flat `status`/`pipelineType` fields remain for backward compatibility but are superseded when `filter` is present. Use `fields` to slim each item to a subset of top-level keys; requesting a key not on the lightweight index entry triggers a full hydration via getRun.',
      inputSchema: z.object({
        status: z.enum(['created', 'running', 'gate-pending', 'waiting-for-escalation', 'loop-guard-pending', 'completed', 'failed', 'discarded']).optional().describe('Filter by run status (legacy — prefer `filter.status`, which accepts arrays). Ignored when `filter` is present.'),
        pipelineType: z.string().optional().describe('Filter by pipeline type (legacy — prefer `filter.pipelineType`, which accepts arrays). Ignored when `filter` is present.'),
        filter: z.object({
          status: z.union([
            z.enum(['created', 'running', 'gate-pending', 'waiting-for-escalation', 'loop-guard-pending', 'completed', 'failed', 'discarded']),
            z.array(z.enum(['created', 'running', 'gate-pending', 'waiting-for-escalation', 'loop-guard-pending', 'completed', 'failed', 'discarded'])),
          ]).optional().describe('Match status — single value or any-of array.'),
          pipelineType: z.union([
            z.string(),
            z.array(z.string()),
          ]).optional().describe('Match pipeline type — single value or any-of array.'),
        }).strict().optional().describe('Structured filter object. Supersedes legacy `status`/`pipelineType` when present. Applies `status` → `pipelineType`, AND-combined.'),
        fields: z.array(z.string()).optional().describe('Top-level keys to include per returned run. Omit for full objects (index-entry shape by default; full hydrated shape when `fields` requests a non-index key). Keys not present on an item are silently dropped for that item.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ status, pipelineType, filter, fields }) => {
      try {
        const projectDir = resolveProjectDir();

        // Index entries carry only these keys (per RunIndexEntry schema in
        // packages/forge-core/src/runs/schemas.js). Anything else requires a
        // full hydration via getRun.
        const INDEX_KEYS = new Set(['runId', 'pipelineType', 'feature', 'status', 'createdAt', 'updatedAt']);

        let entries;

        if (filter) {
          // New path — pull all entries, then apply status → pipelineType in order.
          // Supersedes legacy flat status/pipelineType so users on the new path get
          // predictable behaviour with full array-matching support.
          entries = listRuns(projectDir, {});

          if (filter.status !== undefined) {
            const allowed = Array.isArray(filter.status) ? filter.status : [filter.status];
            entries = entries.filter(e => allowed.includes(e.status));
          }
          if (filter.pipelineType !== undefined) {
            const allowed = Array.isArray(filter.pipelineType) ? filter.pipelineType : [filter.pipelineType];
            entries = entries.filter(e => allowed.includes(e.pipelineType));
          }
        } else {
          // Legacy path — preserved verbatim for backward compatibility.
          entries = listRuns(projectDir, { status, pipelineType });
        }

        // Field projection (orthogonal — runs after whichever filter path applied).
        // If fields requests any key not on the lightweight index entry, hydrate the
        // remaining entries so the projection has the requested data to project from.
        if (fields && fields.length > 0) {
          const needsHydration = fields.some(k => !INDEX_KEYS.has(k));
          if (needsHydration) {
            entries = entries.map(e => {
              // Already-hydrated entries (e.g. from a prior pass) will have non-index keys.
              const alreadyHydrated = Object.keys(e).some(k => !INDEX_KEYS.has(k));
              if (alreadyHydrated) return e;
              try {
                const full = getRun(projectDir, e.runId);
                return full || e;
              } catch (_) {
                return e;
              }
            });
          }
          // Silent key-drop is intentional: requesting a key an item doesn't have
          // is not an error, it just gets omitted from that item.
          entries = entries.map(item => {
            const projected = {};
            for (const key of fields) {
              if (Object.prototype.hasOwnProperty.call(item, key)) {
                projected[key] = item[key];
              }
            }
            return projected;
          });
        }

        // Opportunistic pruning — also runs on list, not just create
        pruneTerminalRuns(projectDir);

        return textResult(entries);
      } catch (err) {
        return errorResult('forge_list_runs failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_update_run --------------------------------------------------

  server.registerTool(
    'forge_update_run',
    {
      title: 'FORGE Update Run',
      description: 'Patches a run with new field values. Automatically sets updatedAt and syncs the index.',
      inputSchema: z.object({
        runId: runIdSchema.describe('Run ID to update'),
        status: z.enum(['created', 'running', 'gate-pending', 'waiting-for-escalation', 'loop-guard-pending', 'completed', 'failed', 'discarded']).optional().describe('New status'),
        worktreePath: z.string().optional().describe('Worktree path if assigned'),
        branchName: z.string().optional().describe('Branch name if assigned'),
        gateState: z.object({
          gate: z.enum(['gate1', 'gate2', 'commit']),
          status: z.enum(['pending', 'approved', 'discarded']),
          feature: z.string(),
          createdAt: z.string(),
          approvedAt: z.string().nullable().default(null),
        }).optional().describe('Gate state update'),
        acknowledged: z.boolean().optional().describe('Mark research run as acknowledged (findings discussed). Clears the observer card.'),
        failureReason: z.string().optional().describe("Why the run failed — set when status is 'failed'"),
        stages: z.record(z.string(), z.object({
          agents: z.array(z.enum([
            'planner', 'researcher', 'gotcha-checker', 'coder', 'coder-scout',
            'debug', 'refactor', 'completeness-checker', 'implementation-architect',
            'documenter', 'reviewer-safety', 'reviewer-boundary', 'reviewer-logic',
            'reviewer-style', 'reviewer-performance',
          ])).default([]),
          status: z.enum(['pending', 'running', 'completed', 'skipped']).default('pending'),
        })).optional().describe("Stage entries to merge into the run's stages map — existing keys are preserved; new keys are added; provided keys are overwritten; completed/skipped stages cannot have status rolled back"),
        agents: z.never().optional().describe('NOT ACCEPTED — agent trail is managed by the hook layer; passing this field returns isError: true'),
        phases: z.array(z.object({
          index: z.number().int().describe('Phase index (0-based)'),
          label: z.string().describe('Phase label from plan heading'),
          status: z.enum(['pending', 'running', 'completed', 'skipped', 'blocked']).describe('Phase execution status'),
          committedAt: z.string().nullable().default(null).describe('ISO timestamp of worktree commit, or null'),
          reviewerVerdict: z.enum(['approved', 'revise', 'blocked']).nullable().default(null).describe('Final reviewer verdict for this phase'),
        })).optional().describe('Phase entries to merge into the run phases array — entries are merged by index field (last-write-wins on collision); null stored phases are initialised from this value'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ runId, ...patch }) => {
      try {
        const projectDir = resolveProjectDir();
        // Strip undefined values so the core function only sees actual changes
        const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));

        // Stages merge: spread existing stages first so incoming entries overlay
        // without discarding unrelated keys. A null existing stages is treated as
        // an empty object — the first patch initialises the map.
        // Forward-only guard: status may not roll back from completed/skipped.
        if (cleanPatch.stages !== undefined) {
          const existingRun = getRun(projectDir, runId);
          const existingStages = (existingRun && existingRun.stages) ? existingRun.stages : {};
          const terminalStatuses = new Set(['completed', 'skipped']);
          const mergedStages = { ...existingStages };
          for (const [key, incoming] of Object.entries(cleanPatch.stages)) {
            const existing = existingStages[key];
            if (existing && terminalStatuses.has(existing.status) && incoming.status && incoming.status !== existing.status) {
              console.error(`[forge_update_run] WARN: backward stage transition blocked for "${key}": ${existing.status} -> ${incoming.status}`);
              mergedStages[key] = { ...existing, ...incoming, status: existing.status };
            } else {
              mergedStages[key] = { ...existing, ...incoming };
            }
          }
          cleanPatch.stages = mergedStages;
        }

        // Phases merge: incoming phase entries are merged by index field.
        // last-write-wins on index collision. A null stored phases array is
        // initialised from the incoming value. No forward-only guard — phases
        // can transition freely during the per-phase execution loop.
        if (cleanPatch.phases !== undefined) {
          const existingRunForPhases = getRun(projectDir, runId);
          const existingPhases = (existingRunForPhases && existingRunForPhases.phases) ? existingRunForPhases.phases : [];
          // Build a map from index -> entry for existing entries
          const phaseMap = new Map();
          for (const entry of existingPhases) {
            phaseMap.set(entry.index, entry);
          }
          // Merge incoming entries by index (last-write-wins)
          for (const entry of cleanPatch.phases) {
            const existing = phaseMap.get(entry.index);
            phaseMap.set(entry.index, existing ? { ...existing, ...entry } : entry);
          }
          // Reconstruct sorted array from map
          cleanPatch.phases = Array.from(phaseMap.values()).sort((a, b) => a.index - b.index);
        }

        // Gate-pending status guard: block transitions out of gate-pending to
        // completed/running without a gate approval token. The model cannot skip
        // gates by calling forge_update_run({ status: 'completed' }) directly.
        // forge_set_gate calls updateRun() core function directly, bypassing this
        // handler, so this guard does not interfere with legitimate approvals.
        // Exception: if the commit gate is already approved, user consent is proven —
        // allow the transition to completed (commit+merge follow-up). Only the commit
        // gate qualifies; earlier gates (gate1, gate2) approved but not yet merged
        // must NOT bypass this guard.
        if (cleanPatch.status && cleanPatch.status !== 'failed' && cleanPatch.status !== 'discarded') {
          const existing = getRun(projectDir, runId);
          if (existing && existing.status === 'gate-pending') {
            const gateAlreadyApproved = existing.gateState && existing.gateState.gate === 'commit' && existing.gateState.status === 'approved';
            if (!hasGateApprovalToken(projectDir) && !gateAlreadyApproved) {
              return errorResult(
                "FORGE: Cannot transition run from gate-pending to '" + cleanPatch.status +
                "' without user approval. Use /forge:approve or /forge:discard.",
              );
            }
          }
        }

        // Worktree path containment: worktreePath must resolve under .worktrees/
        if (cleanPatch.worktreePath) {
          const normalizedWt = resolve(cleanPatch.worktreePath).replace(/\\/g, '/').toLowerCase();
          const expectedBase = resolve(join(projectDir, '.worktrees')).replace(/\\/g, '/').toLowerCase();
          if (!normalizedWt.startsWith(expectedBase + '/') && normalizedWt !== expectedBase) {
            return errorResult("FORGE: worktreePath must be under the project's .worktrees/ directory.");
          }
        }

        // Canonical feature preservation: if the caller provides gateState,
        // override gateState.feature with the stored run.feature. The run's
        // feature (set at forge_create_run) is the authoritative identity —
        // skill prompts that pass a paraphrased name must not drift it.
        if (cleanPatch.gateState) {
          const existing = getRun(projectDir, runId);
          if (existing && existing.feature) {
            cleanPatch.gateState = {
              ...cleanPatch.gateState,
              feature: existing.feature,
            };
          }
        }

        // Auto-null gateState when transitioning to a terminal status.
        // Prevents stale "Action needed" cards in the observer.
        const TERMINAL_STATUSES = new Set(['completed', 'failed', 'discarded']);
        if (cleanPatch.status && TERMINAL_STATUSES.has(cleanPatch.status)) {
          cleanPatch.gateState = null;
        }

        const run = updateRun(projectDir, runId, cleanPatch);
        const mainDir = resolveMainProjectDir();

        // Write completion signal when a research or ideate run finishes
        const REVIEWABLE_TYPES = new Set(['research', 'ideate']);
        if (cleanPatch.status === 'completed' && REVIEWABLE_TYPES.has(run.pipelineType)) {
          const doneDir = join(mainDir, '.pipeline', 'worker-done');
          if (!existsSync(doneDir)) mkdirSync(doneDir, { recursive: true });
          const doneFile = join(doneDir, runId + '.json');
          const signal = {
            runId, feature: run.feature || '', pipelineType: run.pipelineType,
            completedAt: new Date().toISOString(),
          };
          writeFileSync(doneFile, JSON.stringify(signal, null, 2) + '\n', 'utf8');
        }

        // Clean up completion signal when research is acknowledged
        if (cleanPatch.acknowledged) {
          const doneFile = join(mainDir, '.pipeline', 'worker-done', runId + '.json');
          try { unlinkSync(doneFile); } catch (_) {}
        }

        // Clean up heartbeat file when run reaches a terminal status.
        if (cleanPatch.status && TERMINAL_STATUSES.has(cleanPatch.status)) {
          const hbFile = join(mainDir, '.pipeline', 'heartbeats', runId + '.json');
          try { unlinkSync(hbFile); } catch (_) {}
        }

        return textResult(run);
      } catch (err) {
        return errorResult('forge_update_run failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_classify_risk -----------------------------------------------

  server.registerTool(
    'forge_classify_risk',
    {
      title: 'FORGE Classify Risk',
      description: 'Classifies the risk surface of a planned change. Returns a classificationId, advisories, suggested reviewers, and suggested agents. Use before forge_create_run to pre-populate classificationId and reviewerOverrides.',
      inputSchema: z.object({
        feature: z.string().describe('Feature name or short description of the change'),
        filePaths: z.array(z.string()).describe('List of files that will be created or modified'),
        content: z.string().optional().describe('Optional handoff or patch content to scan for risk patterns'),
        forceReview: z.boolean().optional().default(false).describe('Force high risk level and all 5 reviewers regardless of pattern matches'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ feature: _feature, filePaths, content, forceReview }) => {
      try {
        const classificationId = 'cls-' + randomBytes(3).toString('hex');

        if (forceReview) {
          const result = {
            classificationId,
            riskLevel: 'high',
            planStageReview: true,
            advisories: ['forceReview: all reviewers required'],
            reviewers: ['reviewer-safety', 'reviewer-boundary', 'reviewer-logic', 'reviewer-style', 'reviewer-performance'],
            suggestedAgents: ['completeness-checker', 'implementation-architect'],
          };
          if (classificationCache.size >= 500) classificationCache.delete(classificationCache.keys().next().value);
          classificationCache.set(classificationId, result);
          return textResult(result);
        }

        const triggeredRules = new Set();
        const advisories = [];

        // Scan file paths
        for (const fp of filePaths) {
          for (const { pattern, rule } of RISK_PATH_PATTERNS) {
            if (pattern.test(fp)) {
              triggeredRules.add(rule);
              advisories.push('path:' + rule + ' (' + fp + ')');
            }
          }
        }

        // Scan content if provided
        if (content) {
          for (const { pattern, rule } of RISK_CONTENT_PATTERNS) {
            if (pattern.test(content)) {
              triggeredRules.add(rule);
              advisories.push('content:' + rule);
            }
          }
        }

        // Collect unique reviewers from triggered rules
        const reviewerSet = new Set();
        for (const rule of triggeredRules) {
          const mapped = RULE_TO_REVIEWERS[rule];
          if (mapped) {
            for (const r of mapped) reviewerSet.add(r);
          }
        }

        // Derive risk level: high if safety or boundary triggered, medium if any rule, low otherwise
        let riskLevel = 'low';
        if (reviewerSet.has('reviewer-safety') || reviewerSet.has('reviewer-boundary')) {
          riskLevel = 'high';
        } else if (triggeredRules.size > 0) {
          riskLevel = 'medium';
        }

        const reviewers = Array.from(reviewerSet);
        const suggestedAgents = [];
        if (filePaths.length > 5) suggestedAgents.push('completeness-checker');
        if (riskLevel === 'high') suggestedAgents.push('implementation-architect');

        const result = {
          classificationId,
          riskLevel,
          planStageReview: riskLevel === 'high',
          advisories,
          reviewers,
          suggestedAgents,
        };
        if (classificationCache.size >= 500) classificationCache.delete(classificationCache.keys().next().value);
        classificationCache.set(classificationId, result);
        return textResult(result);
      } catch (err) {
        return errorResult('forge_classify_risk failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_create_worktree ---------------------------------------------

  server.registerTool(
    'forge_create_worktree',
    {
      title: 'FORGE Create Worktree',
      description: 'Creates a FORGE-managed git worktree for an existing run. The worktree is at .worktrees/<runId>/ with branch forge/<runId>. Persists worktreePath and branchName onto the run.',
      inputSchema: z.object({
        runId: runIdSchema.describe('Run ID to create a worktree for'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ runId }) => {
      try {
        const projectDir = resolveProjectDir();
        const run = createWorktree(projectDir, runId);
        return textResult(run);
      } catch (err) {
        return errorResult('forge_create_worktree failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_escalate ----------------------------------------------------

  server.registerTool(
    'forge_escalate',
    {
      title: 'FORGE Escalate',
      description: 'Signal that a worker is stuck or needs attention. Writes an escalation file to the MAIN project\'s .pipeline/escalations/ (not the worktree\'s) so the Observer TUI surfaces it. Use when hitting unexpected blockers, errors, or questions that can\'t be resolved autonomously. When responseRequested: true, the worker pauses in waiting-for-escalation state until forge_respond_to_escalation is called.',
      inputSchema: z.object({
        runId: runIdSchema.describe('Run ID to escalate'),
        type: z.enum(['blocker', 'error', 'question']).describe('Type of escalation'),
        message: z.string().min(1).max(500).describe('Short description of what went wrong or what\'s needed'),
        responseRequested: z.boolean().optional().default(false).describe('When true, the worker pauses and waits for a human response via forge_respond_to_escalation before resuming. The response is injected as a user message.'),
        responseTimeoutMs: z.number().int().positive().optional().describe('Override the default 30-minute escalation-poll timeout (in ms). Max 24 h. Stored in the escalation file for informational purposes.'),
        responseHints: z.string().max(500).optional().describe('Optional hints for the human responder — valid options, expected format, context'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ runId, type, message, responseRequested, responseTimeoutMs, responseHints }) => {
      try {
        const projectDir = resolveMainProjectDir();
        const escDir = join(projectDir, '.pipeline', 'escalations');
        if (!existsSync(escDir)) mkdirSync(escDir, { recursive: true });
        const escalationId = 'esc-' + randomBytes(4).toString('hex');
        const escFile = join(escDir, runId + '-' + escalationId + '.json');
        const tmpFile = escFile + '.tmp';
        const data = {
          runId,
          escalationId,
          type,
          message,
          responseRequested: responseRequested || false,
          responseTimeoutMs: responseTimeoutMs || null,
          responseHints: responseHints || null,
          createdAt: new Date().toISOString(),
        };
        writeFileSync(tmpFile, JSON.stringify(data, null, 2) + '\n', 'utf8');
        renameSync(tmpFile, escFile);

        if (responseRequested) {
          // Flip run status to waiting-for-escalation so the worker enters the escalation-poll branch.
          // Reads run.json from the MAIN project dir — same root as the escalations dir.
          try {
            const runPath = join(projectDir, '.pipeline', 'runs', runId, 'run.json');
            const raw = readFileSync(runPath, 'utf-8');
            const runObj = JSON.parse(raw);
            if (runObj.status === 'running') {
              runObj.status = 'waiting-for-escalation';
              runObj.updatedAt = new Date().toISOString();
              writeJsonSafe(runPath, runObj);
            }
          } catch (err) {
            console.error('[forge_escalate] failed to flip status to waiting-for-escalation: ' + err.message);
            // fail-open: escalation file was already written; worker detects via run.json poll
          }
        }

        return textResult({ escalationId, runId, type, message, responseRequested: responseRequested || false, filed: true });
      } catch (err) {
        return errorResult('forge_escalate failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_respond_to_escalation ----------------------------------------

  server.registerTool(
    'forge_respond_to_escalation',
    {
      title: 'FORGE Respond to Escalation',
      description: 'Provide a human response to a worker escalation filed with responseRequested: true. The worker is paused in waiting-for-escalation state; calling this tool writes the response file atomically, which the worker detects and uses to resume. The response is injected as a user message into the worker session.',
      inputSchema: z.object({
        runId: runIdSchema.describe('Run ID of the escalation to respond to'),
        escalationId: z.string().regex(/^esc-[a-f0-9]+$/, 'escalationId must match server-generated format /^esc-[a-f0-9]+$/').describe('Escalation ID returned by forge_escalate (e.g. esc-a1b2c3d4)'),
        response: z.string().min(1).max(2000).describe('Your response — will be injected as a user message into the worker session'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ runId, escalationId, response }) => {
      try {
        const projectDir = resolveMainProjectDir();
        const escDir = join(projectDir, '.pipeline', 'escalations');
        if (!existsSync(escDir)) mkdirSync(escDir, { recursive: true });
        const respFile = join(escDir, runId + '-' + escalationId + '.response.json');
        const tmpFile = respFile + '.tmp';
        const data = { runId, escalationId, response, respondedAt: new Date().toISOString() };
        writeFileSync(tmpFile, JSON.stringify(data, null, 2) + '\n', 'utf8');
        renameSync(tmpFile, respFile);
        return textResult({ ok: true, runId, escalationId, responseWritten: true });
      } catch (err) {
        return errorResult('forge_respond_to_escalation failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_resume_run --------------------------------------------------
  //
  // Restores steering context for a paused or in-progress run. Does NOT mutate
  // the run's status, gateState, or agents — resume only updates
  // run-active.json so the current Claude conversation is pointed at this run,
  // and returns the structured state the future /forge:resume skill needs to
  // render its output. Refuses cleanly on terminal status, unknown runId, wrong
  // project, or missing bound worktree. See docs/RESEARCH/ + handoff for the
  // approved contract.

  server.registerTool(
    'forge_resume_run',
    {
      title: 'FORGE Resume Run',
      description: 'Re-enters a paused or in-progress run by runId. Restores the per-run active file (.pipeline/runs/<runId>/run-active.json); does not progress the run autonomously and does not invoke any pipeline skill.',
      inputSchema: z.object({
        runId: runIdOrBareSchema.describe("Run ID to resume (e.g. r-a1b2c3d4). The 'r-' prefix is added if missing."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ runId }) => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        // Normalize runId — accept both "r-abc" and "abc"
        const normalizedId = runId.startsWith('r-') ? runId : ('r-' + runId);

        // Precondition 1: run exists in registry
        const run = getRun(projectDir, normalizedId);
        if (!run) {
          return errorResult('Run ' + normalizedId + ' not found in registry');
        }

        // Precondition 2: status is non-terminal
        const RESUMABLE = new Set(['running', 'gate-pending', 'created', 'waiting-for-escalation']);
        if (!RESUMABLE.has(run.status)) {
          return errorResult(
            'Run ' + normalizedId + ' is ' + run.status + '; resume only supports running, gate-pending, or created',
          );
        }

        // Precondition 3: projectRoot matches current project
        if (run.projectRoot && !pathsEqual(run.projectRoot, projectDir)) {
          return errorResult(
            'Run ' + normalizedId + ' belongs to project ' + run.projectRoot +
            '; current project is ' + projectDir,
          );
        }

        // Precondition 4: bound worktree, if any, must exist on disk
        if (run.worktreePath && !existsSync(run.worktreePath)) {
          return errorResult(
            "Run " + normalizedId + "'s worktree at " + run.worktreePath +
            ' no longer exists. Restore the worktree directory or discard the run.',
          );
        }

        // Report-only recovery primitive: read the previous run-active.json's
        // `currentUnit` BEFORE overwriting. If it is non-null, the prior session
        // ended while a FORGE agent was in flight (SubagentStop never fired).
        // We surface this to the skill as a stale-lock signal; the new
        // run-active.json starts with a clean slate (no in-flight marker).
        //
        // Truthfulness: if the prior marker belongs to a run that is already
        // terminal (completed / failed / discarded), the marker is stale-by-
        // finish rather than stale-by-crash — suppress it so /forge:resume
        // doesn't render a misleading notice. Mirrors the SessionStart cleanup
        // in hooks/ctx-session-start.js. Defensive: if the referenced run can't
        // be verified (no prior runId / registry miss / throw), keep the marker.
        const TERMINAL_STATUSES = new Set(['completed', 'failed', 'discarded']);
        // Read prior currentUnit from the per-run active file for the run being resumed.
        // The singleton is no longer written; use getRunActivePath to locate state.
        const priorRunActivePath = getRunActivePath(projectDir, run.runId);
        let staleUnit = null;
        try {
          const priorRaw = readFileSync(priorRunActivePath, 'utf8');
          const prior = JSON.parse(priorRaw);
          if (prior && prior.currentUnit && typeof prior.currentUnit === 'object') {
            staleUnit = prior.currentUnit;
            const priorRunId = typeof prior.runId === 'string' ? prior.runId : null;
            if (priorRunId) {
              try {
                const priorRun = getRun(projectDir, priorRunId);
                if (priorRun && TERMINAL_STATUSES.has(priorRun.status)) {
                  staleUnit = null;
                }
              } catch (_) {
                // Registry lookup failed — keep the marker (defensive).
              }
            }
          }
        } catch (_) {
          // Absent / unreadable / unparseable — no stale signal, not an error.
          staleUnit = null;
        }

        // Success effect: write per-run active file (sole authoritative source).
        // We do NOT mutate run.status, gateState, or agents — those are
        // owned by the pipeline skills; resume only restores the per-session pointer.
        const runActiveData = {
          startedAt: Date.now(),
          runId: run.runId,
          pipelineType: run.pipelineType,
          feature: run.feature,
          agents: [],
        };
        if (run.worktreePath) runActiveData.worktreePath = run.worktreePath;
        if (run.stages != null) {
          runActiveData.stages = run.stages;
        }

        try {
          writeRunActive(projectDir, run.runId, runActiveData);
        } catch (writeErr) {
          return errorResult(
            'Failed to update per-run active file: ' + writeErr.message + '. Run-active state was not modified.',
          );
        }

        // Return structured fields for the future /forge:resume skill to render.
        return textResult({
          runId: run.runId,
          pipelineType: run.pipelineType,
          feature: run.feature,
          status: run.status,
          gateState: run.gateState || null,
          worktreePath: run.worktreePath || null,
          branchName: run.branchName || null,
          currentUnit: staleUnit,
        });
      } catch (err) {
        return errorResult('forge_resume_run failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_advance_stage -----------------------------------------------
  //
  // Advances a run to a named pipeline stage: validates the run is non-terminal,
  // verifies no other stage is currently running, marks the target stage as
  // "running", then spawns a headless forge-worker.mjs in the run's working dir.
  // Models on forge_create_run (spawn block) and forge_resume_run (validation).

  server.registerTool(
    'forge_advance_stage',
    {
      title: 'FORGE Advance Stage',
      description: "Advances a run to the named pipeline stage. Validates the run is non-terminal and no other stage is currently running, marks the target stage as 'running', then spawns a headless forge-worker.mjs worker.",
      inputSchema: z.object({
        runId: runIdSchema.describe('Run ID (e.g. r-a1b2c3d4)'),
        targetStage: z.string().min(1).describe("Stage name to advance to (e.g. 'implement', 'review')"),
        agents: z.array(z.string()).optional().describe('Agent list to store in stages[targetStage].agents. When omitted, defaults to [].'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ runId, targetStage, agents }) => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        // Validate run exists
        // eslint-disable-next-line prefer-const
        let run = getRun(projectDir, runId);
        if (!run) {
          return errorResult('Run ' + runId + ' not found in registry');
        }

        // Validate run is non-terminal
        const TERMINAL_STATUSES = new Set(['completed', 'failed', 'discarded']);
        if (TERMINAL_STATUSES.has(run.status)) {
          return errorResult(
            'Run ' + runId + ' is ' + run.status + '; cannot advance a terminal run',
          );
        }

        // Validate no other stage is currently running.
        // Auto-complete the prior running stage when the run is gate-pending with an
        // approved gateState — this is the conductor flow after gate1/gate2 approval
        // where the worker exits without flipping the prior stage's status to
        // 'completed'. Without auto-complete, the conductor must manually patch
        // stages.<prior>.status='completed' before every forge_advance_stage call.
        // Closes 7fe538ee sub-bug 3.
        const stages = run.stages || {};
        const runningStage = Object.entries(stages).find(
          ([name, s]) => s.status === 'running' && name !== targetStage,
        );
        const gateApproved =
          run.gateState &&
          run.gateState.status === 'approved';
        if (runningStage && !gateApproved) {
          return errorResult(
            'Stage `' + runningStage[0] + '` is still running — complete it before advancing',
          );
        }

        // Sweep stale PID files BEFORE flipping status to 'running' — orphan PIDs
        // from the prior stage are cleaned up while run.status is still 'gate-pending',
        // so sweepStalePids' markRunFailed guard (`runData.status === 'running'`) cannot
        // fire against the newly-advanced run.  Fixes the sweep-after-set race (TODO 9424e08a).
        const mainProjectDirAdv = resolveMainProjectDir();
        const sweepResultAdv = sweepStalePids(mainProjectDirAdv);
        if (sweepResultAdv.swept > 0) {
          console.error('[forge_advance_stage] sweepStalePids swept ' + sweepResultAdv.swept + ' stale PID(s), alive=' + sweepResultAdv.alive + ', errors=' + sweepResultAdv.errors);
        }

        // Mark target stage as running; auto-complete the prior running stage if any.
        const stagesPatch = {
          ...stages,
          [targetStage]: { status: 'running', agents: Array.isArray(agents) ? agents : [] },
        };
        if (runningStage) {
          stagesPatch[runningStage[0]] = { ...runningStage[1], status: 'completed' };
        }
        // Clear phases on stage transition so the new stage's worker can populate
        // its own phase entries without colliding by-index with the prior stage's
        // (e.g. plan-stage Phase A at index 0 vs implement-stage Phase 1 at index 0).
        // Observer rendered "6/6 phases" for an implementing run because the plan
        // stage's completed phases were still in phases[].
        const updatedRun = updateRun(projectDir, runId, { stages: stagesPatch, status: 'running', phases: null });

        // Refresh per-run active file stages so subagent hooks see the updated allowlist.
        // Note: forge_update_run does not touch run-active files by design; only
        // forge_create_run, forge_resume_run, and forge_advance_stage do. If the
        // conductor calls forge_update_run({ stages: ... }) mid-run to add a reviewer
        // agent, the per-run active file won't reflect it until next resume — the
        // allowlist warning may fire spuriously for that agent. Acceptable limitation.
        // Fail-open: if per-run active file is absent, skip silently.
        try {
          const perRunActivePath = getRunActivePath(projectDir, runId);
          const rawPerRun = readFileSync(perRunActivePath, 'utf8');
          const perRunData = JSON.parse(rawPerRun);
          if (perRunData && typeof perRunData === 'object') {
            perRunData.stages = updatedRun.stages ?? null;
            writeRunActive(projectDir, runId, perRunData);
          }
        } catch (_) {
          // Per-run active file absent or unreadable — skip silently (fail-open)
        }

        // Guard: prevent recursive spawning inside a worker process. Env-var check
        // (set by mcp/forge-worker.mjs when spawning the worker's MCP server) is
        // race-free vs. the previous file-system check; see forge_create_run for
        // the full rationale.
        if (process.env.FORGE_WORKER_SESSION === '1') {
          console.error('[forge_advance_stage] FORGE_WORKER_SESSION is set — skipping spawn (already inside a worker)');
          return textResult({ runId, targetStage, workerSpawned: false, logFile: null });
        }

        // Seam A (AC-8): create worktree before spawning the implement worker.
        // createWorktree persists worktreePath/branchName onto the run and returns
        // the updated run object — merge so we don't clobber other fields.
        // Falls back to updateRun path-only persistence when the project root is
        // not a git repo (e.g. in integration tests against a temp directory).
        if (targetStage === 'implement' && !run.worktreePath) {
          const wtPath = join(projectDir, '.worktrees', runId);
          const branchName = 'forge/' + runId;
          try {
            const wtRun = createWorktree(projectDir, runId);
            run = { ...run, worktreePath: wtRun.worktreePath, branchName: wtRun.branchName };
          } catch (wtErr) {
            // Non-git environment (e.g. test fixture): persist the path without git ops.
            const persisted = updateRun(projectDir, runId, { worktreePath: wtPath, branchName });
            run = { ...run, worktreePath: persisted.worktreePath, branchName: persisted.branchName };
          }
        }

        // Guard: prevent worker collision (AC-11) — narrowed to true conflicts.
        //
        // At this point `run` has its final worktreePath/branchName. Apply the
        // predicate against other running runs:
        //   (a.worktreePath && a.worktreePath === b.worktreePath) ||
        //   (a.branchName   && a.branchName   === b.branchName)   ||
        //   (a.worktreePath === null && b.worktreePath === null && a.projectRoot === b.projectRoot)
        const runningForCollision = listRuns(projectDir, { status: 'running' }).filter(r => r.runId !== runId);
        const collidingRuns = runningForCollision.filter((b) => {
          if (run.worktreePath && run.worktreePath === b.worktreePath) return true;
          if (run.branchName && run.branchName === b.branchName) return true;
          if (run.worktreePath == null && b.worktreePath == null && run.projectRoot === b.projectRoot) return true;
          return false;
        });
        if (collidingRuns.length > 0) {
          const conflicting = collidingRuns.map(r => r.runId).join(', ');
          return errorResult(
            'Worker collision blocked: run(s) ' + conflicting + ' conflict with this run\'s worktree, branch, or main-root slot. Wait for them to finish or mark them failed/discarded before advancing.',
          );
        }

        // Write worker-task-<runId>.json in the run's working directory
        const workDir = run.worktreePath || projectDir;
        const taskDir = join(workDir, '.pipeline');
        if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });
        const safeFeature = sanitizeFeatureName(run.feature || '');
        const taskFilePath = join(taskDir, 'worker-task-' + runId + '.json');
        writeFileSync(
          taskFilePath,
          JSON.stringify(
            { runId, feature: safeFeature, pipelineType: targetStage, originalPipelineType: run.pipelineType, targetStage, createdAt: new Date().toISOString() },
            null,
            2,
          ) + '\n',
          'utf-8',
        );

        // Spawn forge-worker.mjs headlessly (same pattern as forge_create_run)
        const workerScriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'forge-worker.mjs');
        const logFile = workerLogPath(projectDir, runId);
        const logDir = join(projectDir, '.pipeline', 'worker-logs');
        if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
        const logFd = openSync(logFile, 'a');
        let child;
        try {
          child = nodeSpawn(process.execPath, [workerScriptPath], {
            cwd: workDir,
            detached: process.platform !== 'win32',
            windowsHide: true,
            stdio: ['ignore', logFd, logFd],
            env: { ...process.env, FORGE_WORKER_RUN_ID: runId },
          });
          // Mirror forge_create_run: record the worker PID so liveness sweeps (sweepStalePids)
          // and external watchers can detect this advance-spawned worker. advance_stage previously
          // skipped this — only forge_create_run wrote it — so pid-based death-detection saw the
          // run as having no worker for advance→implement runs.
          const pidDir = join(projectDir, '.pipeline', 'worker-pids');
          mkdirSync(pidDir, { recursive: true });
          const pidFile = join(pidDir, runId + '.json');
          writeJsonSafe(pidFile, { runId, pid: child.pid, startedAt: new Date().toISOString() });
          child.on('error', (err) => {
            console.error('[forge_advance_stage] worker spawn failed: ' + err.message);
            try { unlinkSync(taskFilePath); } catch (_) {}
            try { unlinkSync(pidFile); } catch (_) {}
            // Mark run as failed so conductor can see the spawn failure
            try {
              const runFilePath = join(projectDir, '.pipeline', 'runs', runId, 'run.json');
              const raw = readFileSync(runFilePath, 'utf-8');
              const runData = JSON.parse(raw);
              if (runData.status === 'running') {
                runData.status = 'failed';
                runData.failureReason = 'worker spawn error (advance_stage): ' + err.message;
                runData.updatedAt = new Date().toISOString();
                writeJsonSafe(runFilePath, runData);
              }
            } catch (updateErr) {
              console.error('[forge_advance_stage] error handler failed to update run status: ' + updateErr.message);
            }
          });
          child.on('exit', (code) => {
            try { closeSync(logFd); } catch (_) {}
            try { unlinkSync(pidFile); } catch (_) {}
            if (code !== 0 && code !== null) {
              try {
                const runFilePath = join(projectDir, '.pipeline', 'runs', runId, 'run.json');
                const raw = readFileSync(runFilePath, 'utf-8');
                const runData = JSON.parse(raw);
                if (runData.status === 'running') {
                  runData.status = 'failed';
                  runData.failureReason = 'worker process exited with code ' + code + ' (advance_stage)';
                  runData.updatedAt = new Date().toISOString();
                  writeJsonSafe(runFilePath, runData);
                }
              } catch (exitErr) {
                console.error('[forge_advance_stage] exit handler failed to update run status: ' + exitErr.message);
              }
            }
          });
          child.unref();
        } catch (spawnErr) {
          try { closeSync(logFd); } catch (_) {}
          throw spawnErr;
        }

        return textResult({ runId, targetStage, workerSpawned: true, logFile });
      } catch (err) {
        return errorResult('forge_advance_stage failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_dashboard_state ---------------------------------------------
  //
  // Read-only control-plane snapshot. Returns a compact registry-backed summary
  // of active runs, pending gates, recent completed runs, and board counts so
  // future UI surfaces (skill, TUI, tiny HTTP sidecar) can share one stable
  // data contract. Intentionally stops at the contract layer — no server, no
  // WebSocket, no file watcher, no background-worker assumptions.
  //
  // The state-building logic lives in mcp/lib/dashboard-state.js so the local
  // HTTP sidecar at scripts/dashboard-server.mjs can reuse the exact same code.

  server.registerTool(
    'forge_dashboard_state',
    {
      title: 'FORGE Dashboard State',
      description:
        'Read-only control-plane snapshot: active runs, pending gates, recent completed runs, and board summary. Backed by the existing registry and board files — no new persisted state, no background worker, no file watcher. Future UI surfaces consume this single shape.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;
        return textResult(await buildDashboardState(projectDir));
      } catch (err) {
        return errorResult('forge_dashboard_state failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_kill_worker -------------------------------------------------

  server.registerTool(
    'forge_kill_worker',
    {
      title: 'FORGE Kill Worker',
      description:
        'Request graceful shutdown of a running worker. Writes a poison-pill sentinel file that the worker detects within 1 s and uses to stop itself, then optionally sends SIGTERM if the PID sidecar exists. The worker updates run status to "discarded" on pill detection — do not update run status here.',
      inputSchema: z.object({
        runId: runIdSchema.describe('Run ID of the worker to kill.'),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ runId }) => {
      try {
        const projectDir = resolveProjectDir();

        // (a) Write poison-pill sentinel file
        const pillPath = killPillPath(projectDir, runId);
        mkdirSync(join(projectDir, '.pipeline', 'worker-kill'), { recursive: true });
        // Overwrite silently if it already exists (idempotent)
        writeFileSync(pillPath, '', 'utf-8');

        // (b) Send SIGTERM if PID sidecar exists and contains a valid numeric PID
        let pidSignaled = false;
        let pid = null;
        const pidFile = join(projectDir, '.pipeline', 'worker-pids', runId + '.json');
        if (existsSync(pidFile)) {
          try {
            const pidData = JSON.parse(readFileSync(pidFile, 'utf-8'));
            if (typeof pidData.pid === 'number' && Number.isFinite(pidData.pid)) {
              pid = pidData.pid;
              try {
                process.kill(pid, 'SIGTERM');
                pidSignaled = true;
              } catch (killErr) {
                // fail-open: process may have already exited; log but do not throw
                console.error('[forge_kill_worker] SIGTERM failed for pid ' + pid + ': ' + killErr.message);
              }
            }
          } catch (readErr) {
            // fail-open: PID sidecar unreadable — pill file is sufficient
            console.error('[forge_kill_worker] failed to read PID sidecar: ' + readErr.message);
          }
        }

        return textResult({ ok: true, poisonPillWritten: true, pidSignaled, pid });
      } catch (err) {
        return errorResult('forge_kill_worker failed: ' + err.message);
      }
    },
  );

}
