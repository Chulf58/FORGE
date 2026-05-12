#!/usr/bin/env node
// Pure-function simulator of the plan-stage REVISE retry loop.
// Extracted from skills/plan/SKILL.md spec for isolated unit testing.
//
// Mirrors the implement-stage loop (skills/implement/SKILL.md:250-264) with
// one divergence: when M >= 2 and still REVISE, writes gate1 with
// revisingUnresolved: true instead of failing the run — the conductor can fix
// PLAN.md inline and approve manually.

/**
 * @typedef {{ revisionMode: number }} PlannerInvocation
 * @typedef {{ status: 'pending', revisingUnresolved?: true }} Gate1
 *
 * @typedef {{
 *   plannerInvocations: PlannerInvocation[];
 *   gate1: Gate1 | null;
 *   failed: boolean;
 *   blocked: boolean;
 * }} LoopResult
 */

const MAX_REVISIONS = 2;

/**
 * Simulate the plan-stage REVISE retry loop.
 *
 * @param {string[]} verdictSequence
 *   Array of verdicts ('APPROVED' | 'REVISE' | 'BLOCK'), one per planner pass.
 *   Index 0 is the verdict for the initial pass; index 1 is the verdict after
 *   the first retry; etc.
 * @returns {LoopResult}
 */
export function runPlanReviseLoop(verdictSequence) {
  /** @type {PlannerInvocation[]} */
  const plannerInvocations = [];

  /** @type {Gate1 | null} */
  let gate1 = null;
  let failed = false;
  let blocked = false;
  let m = 0;

  // Step 1: invoke planner with M=0 (initial pass)
  plannerInvocations.push({ revisionMode: 0 });

  while (true) {
    const verdict = verdictSequence[plannerInvocations.length - 1];

    if (verdict === 'BLOCK') {
      // Step 3: BLOCK — set failed/blocked, do NOT write gate1, exit
      failed = true;
      blocked = true;
      break;
    }

    if (verdict === 'APPROVED') {
      // Step 4: APPROVED — write clean gate1 and exit
      gate1 = { status: 'pending' };
      break;
    }

    // REVISE path
    if (m < MAX_REVISIONS) {
      // Step 5a: M < 2 — increment M and re-invoke planner with revision-mode M
      m += 1;
      plannerInvocations.push({ revisionMode: m });
      // continue to read next verdict
    } else {
      // Step 5b: M >= 2 — loop exhausted; plan-stage divergence from implement-stage:
      // write gate1 with revisingUnresolved marker instead of failing the run so the
      // conductor can fix PLAN.md inline and approve manually.
      gate1 = { status: 'pending', revisingUnresolved: true };
      break;
    }
  }

  return { plannerInvocations, gate1, failed, blocked };
}
