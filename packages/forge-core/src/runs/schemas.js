// schemas.js — Run schema definitions (Zod)
// This is the single source of truth for what a FORGE run object looks like.

import { z } from 'zod';

export const RunStatus = z.enum([
  'created',     // run exists, not started
  'running',     // pipeline actively executing
  'gate-pending', // waiting for user approval at a gate
  'completed',   // pipeline finished successfully
  'failed',      // pipeline errored
  'discarded',   // user discarded at a gate
]);

export const GateState = z.object({
  gate: z.enum(['gate1', 'gate2']),
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
});

export const Run = z.object({
  runId: z.string(),
  sessionId: z.string(),
  projectRoot: z.string(),
  worktreePath: z.string().nullable().default(null),
  branchName: z.string().nullable().default(null),
  pipelineType: z.enum(['plan', 'implement', 'apply', 'debug', 'refactor']),
  mode: z.enum(['SPRINT', 'LEAN', 'STANDARD', 'FULL']),
  feature: z.string().default(''),
  status: RunStatus.default('created'),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentStep: z.string().nullable().default(null),
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
});

// Index entry — lightweight pointer stored in runs/index.json
export const RunIndexEntry = z.object({
  runId: z.string(),
  pipelineType: z.string(),
  feature: z.string(),
  status: RunStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const RunIndex = z.object({
  runs: z.array(RunIndexEntry).default([]),
});
