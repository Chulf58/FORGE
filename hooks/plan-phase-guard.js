'use strict';

// plan-phase-guard.js — PreToolUse (Agent) hook.
//
// Structural guard against the in-session plan-pipeline phase skip (TODO d2e807e2):
// the conductor jumping from Phase B straight to Phase D reviewers without running
// the grill-plan walkthrough (Phase C). Denies a plan-stage reviewer dispatch on an
// active PLAN run until Phase C is recorded completed in run.phases.
//
// Source of truth: run.phases (written by skills/plan/SKILL.md — Phase B {index:1,
// label:"Phase B — planner"}, Phase C {index:2, label:"Phase C — plan walkthrough",
// status:"running"->"completed"}). Entry shape: { index, label, status }.
//
// STRENGTHENED deny (plan run + plan-stage reviewer), per PLAN.md Resolution 2026-05-31 (b):
//   DENY (exit 2) when EITHER
//     (i)  a Phase C entry exists with a string status !== "completed", OR
//     (ii) the Phase C entry is ABSENT but a Phase B entry is present
//          (progressed past B, grill-plan never recorded — the total-skip case).
//   FAIL-OPEN (exit 0) for: phases null/non-array/empty; Phase C present but malformed
//   (no string status); no Phase B/C progress recorded at all; non-plan pipelineType;
//   non-reviewer agent; no resolvable active run. A guard that over-blocks is worse
//   than the skip (CLAUDE.md gotcha #4) — every ambiguous case fails open.

const readline = require('readline');
const {
  resolveProjectDir,
  STDIN_TIMEOUT_SHORT,
  findActiveRun,
  normalizeAgentType,
} = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

// A plan-stage reviewer is the technical-skeptic or any reviewer-* agent. These run
// in Phase D, after the grill-plan walkthrough (Phase C). gotcha-checker/planner run
// in Phase B and are intentionally NOT guarded.
function isPlanReviewer(normalizedType) {
  return normalizedType === 'technical-skeptic' || normalizedType.startsWith('reviewer-');
}

function isPhaseEntry(p, letter, index) {
  if (!p || typeof p !== 'object') return false;
  if (p.index === index) return true;
  return typeof p.label === 'string' && new RegExp('phase ' + letter, 'i').test(p.label);
}
const isPhaseC = (p) => isPhaseEntry(p, 'c', 2);
const isPhaseB = (p) => isPhaseEntry(p, 'b', 1);

function exitOk() {
  process.exit(0);
}

function deny(reason) {
  // Canonical PreToolUse deny envelope — the harness only honors the hard-stop in the
  // hookSpecificOutput shape (matching bash-guard.js / agent-loop-guard.js). A flat
  // { permissionDecision } is silently ignored.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }) + '\n');
  process.stderr.write(reason + '\n');
  process.exit(2);
}

async function main(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    exitOk();
    return;
  }

  // Only intercept Agent tool calls.
  if (!payload || payload.tool_name !== 'Agent') {
    exitOk();
    return;
  }

  const rawType = payload.tool_input && payload.tool_input.subagent_type
    ? payload.tool_input.subagent_type
    : null;
  const normalizedType = normalizeAgentType(rawType);

  // Not a plan-stage reviewer — fail open (gotcha-checker, planner, coder, etc.).
  if (!normalizedType || !isPlanReviewer(normalizedType)) {
    exitOk();
    return;
  }

  const projectDir = resolveProjectDir(payload);

  // Resolve the active run. Zero or 2+ non-terminal runs → null → fail open.
  const active = await findActiveRun(projectDir);
  if (!active || !active.runData) {
    exitOk();
    return;
  }
  const run = active.runData;

  // Only guard PLAN runs.
  if (run.pipelineType !== 'plan') {
    exitOk();
    return;
  }

  const phases = run.phases;
  // No phase tracking at all — fail open (old runs, malformed state).
  if (!Array.isArray(phases) || phases.length === 0) {
    exitOk();
    return;
  }

  const phaseC = phases.find(isPhaseC);
  const phaseB = phases.find(isPhaseB);

  let denyReason = null;
  if (phaseC) {
    // Malformed Phase C entry (no string status) — fail open, do not guess.
    if (typeof phaseC.status !== 'string') {
      exitOk();
      return;
    }
    if (phaseC.status !== 'completed') {
      denyReason = 'Phase C (the grill-plan walkthrough) is "' + phaseC.status +
        '", not completed';
    }
  } else if (phaseB) {
    // Phase C entry absent but Phase B is recorded — grill-plan was skipped entirely.
    denyReason = 'Phase C (the grill-plan walkthrough) was skipped — Phase B is ' +
      'recorded but no Phase C entry exists';
  } else {
    // No Phase B/C progress recorded — fail open.
    exitOk();
    return;
  }

  if (!denyReason) {
    // Phase C completed — allow.
    exitOk();
    return;
  }

  const safeType = String(normalizedType).replace(/[\r\n]/g, ' ').trim();
  deny(
    '[forge-plan-phase] Denying plan-stage reviewer "' + safeType + '": ' + denyReason +
    '. Run the grill-plan walkthrough (Phase C) to completion before dispatching plan-stage reviewers.'
  );
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
