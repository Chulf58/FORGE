// schemas.js — Run schema definitions (Zod)
// This is the single source of truth for what a FORGE run object looks like.

import { z } from 'zod';

export const RunStatus = z.enum([
  'created',               // run exists, not started
  'running',               // pipeline actively executing
  'gate-pending',          // waiting for user approval at a gate
  'waiting-for-escalation', // worker paused waiting for human response to forge_escalate
  'loop-guard-pending',    // agent dispatch cap hit — waiting for /forge:unblock
  'completed',             // pipeline finished successfully
  'failed',                // pipeline errored
  'discarded',             // user discarded at a gate
]);

export const GateState = z.object({
  gate: z.enum(['gate1', 'gate2', 'commit']),
  status: z.enum(['pending', 'approved', 'discarded']),
  feature: z.string(),
  createdAt: z.string(),
  approvedAt: z.string().nullable().default(null),
}).nullable();

export const RunAgent = z.object({
  agentId: z.string(),
  agentType: z.string().nullable().default(null),
  startedAt: z.number(),
  completedAt: z.number().nullable().default(null),
  durationMs: z.number().nullable().default(null),
  outcome: z.string().nullable().default(null),
  // Diagnosability (r-5d8837d6): the orchestrator stamps WHY an agent was uncertain (reason) and
  // how many dispatch attempts ran (attempts) via implement-stage.mjs stampedDispatch. Without
  // these in the schema, getRun + dashboard strip them on read, so the persisted reason never
  // surfaces. Nullable + default null so pre-existing agent entries parse unchanged.
  reason: z.string().nullable().default(null),
  attempts: z.number().int().nullable().default(null),
});

export const PhaseEntry = z.object({
  index: z.number().int(),
  label: z.string(),
  // 'revise-unresolved' (W3 Phase Execution Loop): a phase that hit the REVISE cap — the run-level
  // status goes 'failed' with a phase-scoped failureReason; the phase entry records this terminal state.
  status: z.enum(['pending', 'running', 'completed', 'skipped', 'blocked', 'revise-unresolved']),
  committedAt: z.string().nullable().default(null),
  reviewerVerdict: z.enum(['approved', 'revise', 'blocked']).nullable().default(null),
});

export const Run = z.object({
  runId: z.string(),
  sessionId: z.string(),
  projectRoot: z.string(),
  worktreePath: z.string().nullable().default(null),
  branchName: z.string().nullable().default(null),
  pipelineType: z.enum(['plan', 'implement', 'apply', 'debug', 'refactor', 'research', 'explore', 'ideate']),
  feature: z.string().default(''),
  status: RunStatus.default('created'),
  createdAt: z.string(),
  updatedAt: z.string(),
  gateState: GateState.default(null),
  agents: z.array(RunAgent).default([]),
  artifacts: z.object({
    plan: z.string().nullable().default(null),
    handoff: z.string().nullable().default(null),
    scout: z.string().nullable().default(null),
  }).default({}),
  // Report-only merge-blocked marker. Set by forge-worktree.js merge() on
  // failure; null on all runs that never attempted or successfully completed
  // merge-back. Does not change the run's status (which stays "completed" —
  // the pipeline itself succeeded; the merge-back is a post-pipeline step).
  mergeBlocked: z.object({
    reason: z.string(),
    detectedAt: z.string(),
  }).nullable().default(null),
  failureReason: z.string().nullable().default(null),
  // Optional back-reference to the run that spawned this one (e.g. plan → implement chain).
  parentRunId: z.string().regex(/^r-[a-zA-Z0-9]+$/).nullable().default(null),
  // Pipeline stage tracking — keys are stage names, values are per-stage objects.
  // Null until the first stage update is written via forge_update_run.
  stages: z.record(z.string(), z.object({
    agents: z.array(z.enum([
      'planner',
      'researcher',
      'gotcha-checker',
      'coder',
      'coder-scout',
      'debug',
      'refactor',
      'completeness-checker',
      'implementation-architect',
      'documenter',
      'reviewer-safety',
      'reviewer-boundary',
      'reviewer-logic',
      'reviewer-style',
      'reviewer-performance',
    ])).default([]),
    status: z.enum(['pending', 'running', 'completed', 'skipped']).default('pending'),
  })).nullable().default(null),
  // ID of the risk classification produced by forge_classify_risk for this run.
  classificationId: z.string().nullable().default(null),
  // Explicit reviewer overrides — when set, the dispatcher uses this list
  // instead of deriving reviewers from the risk classification.
  reviewerOverrides: z.array(z.string()).default([]),
  // Per-phase execution tracking — populated when the feature plan uses
  // ## Phase N — <label> headings. Null for single-phase (non-partitioned) features.
  phases: z.array(PhaseEntry).nullable().default(null),
  acknowledged: z.boolean().default(false),
  // Populated when loop-guard fires — merged from the sidecar file by forge_get_run.
  // Absent on all runs that have never hit the dispatch cap.
  loopGuardEvent: z.object({
    agentType: z.string(),
    blockedAt: z.string(),
    dispatchCount: z.number(),
    runId: z.string(),
  }).nullable().optional(),
});

// Index entry — lightweight pointer stored in runs/index.json
export const RunIndexEntry = z.object({
  runId: z.string(),
  pipelineType: z.string(),
  feature: z.string(),
  status: RunStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
  parentRunId: z.string().regex(/^r-[a-zA-Z0-9]+$/).nullable().default(null),
  classificationId: z.string().nullable().default(null),
});

export const RunIndex = z.object({
  runs: z.array(RunIndexEntry).default([]),
});
