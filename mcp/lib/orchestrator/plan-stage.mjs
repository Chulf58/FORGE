// mcp/lib/orchestrator/plan-stage.mjs
// Deterministic plan-stage state machine.
// Replaces the prose-following query() path for plan-stage workers when
// FORGE_ORCHESTRATOR_PLAN=on is set in the environment.

import { join } from 'node:path';

/**
 * Prompt lines sent to the planner agent on initial dispatch.
 * @param {string} workDir
 * @param {string} runId
 * @returns {string[]}
 */
function plannerPromptLines(workDir, runId) {
  return [
    'You are the planner agent.',
    'WorkDir: ' + workDir,
    'RunId: ' + runId,
  ];
}

/**
 * Prompt lines for the gotcha-checker agent.
 * @param {string} workDir
 * @returns {string[]}
 */
function gotchaCheckerPromptLines(workDir) {
  return [
    'You are the gotcha-checker agent.',
    'WorkDir: ' + workDir,
  ];
}

/**
 * Prompt lines for the researcher agent.
 * @param {string} workDir
 * @returns {string[]}
 */
function researcherPromptLines(workDir) {
  return [
    'You are the researcher agent.',
    'WorkDir: ' + workDir,
  ];
}

/**
 * Prompt lines for a reviewer agent.
 * @param {string} reviewerType
 * @param {string} workDir
 * @param {string} runId
 * @returns {string[]}
 */
function reviewerPromptLines(reviewerType, workDir, runId) {
  return [
    'You are the ' + reviewerType + ' agent.',
    'Stage: plan',
    'WorkDir: ' + workDir,
    'RunId: ' + runId,
  ];
}

/**
 * One-level merge for run.json objects, preserving orchestratorState sibling fields.
 *
 * @param {object} current - existing run object
 * @param {object} patch - fields to merge
 * @returns {object} merged object
 */
function mergeRun(current, patch) {
  const merged = Object.assign({}, current, patch);
  if (patch.orchestratorState != null || current.orchestratorState != null) {
    merged.orchestratorState = Object.assign(
      {},
      current.orchestratorState ?? {},
      patch.orchestratorState ?? {},
    );
  }
  return merged;
}

/**
 * Runs the deterministic plan-stage orchestration sequence.
 *
 * @param {object} deps - injected dependencies
 * @param {function(string, object?): Promise<object>} deps.readRunJson - reads run.json
 * @param {function(string, object): Promise<void>} deps.writeRunJson - writes run.json (path, data)
 * @param {function(string, object): Promise<void>} deps.writeGateFile - writes gate-pending.json (path, data)
 * @param {function(string?): Promise<string>} deps.readPlanMd - reads PLAN.md content
 * @param {function(string?): Promise<void>} deps.clearReviewerOutput - clears reviewer output dir
 * @param {function(string, string): Promise<{verdict: string}>} deps.readReviewerOutput - reads a reviewer verdict
 * @param {function(string, string[]): Promise<{stdout: string, exitCode: number}>} deps.spawnScript - spawns a node script
 * @param {function(string, string[]): Promise<object>} deps.dispatch - dispatches an agent
 * @param {function(string): void} [deps.writeLog] - optional log function
 * @param {string} runId - the run identifier
 * @param {string} workDir - the worktree path
 */
export async function runPlanStageOrchestrator(deps, runId, workDir) {
  const writeLog = deps.writeLog || ((msg) => console.error(msg));

  const runJsonPath = join(workDir, '..', '.pipeline', 'runs', runId, 'run.json');
  const reviewerOutputDir = join(workDir, '.pipeline', 'context', 'reviewer-output');
  const gatePendingPath = join(workDir, '.pipeline', 'gate-pending.json');

  try {
    // Step 1: Read initial run state and extract revision counter
    const initialRun = await deps.readRunJson(runJsonPath);
    let M = (initialRun && initialRun.orchestratorState && typeof initialRun.orchestratorState.planReviseCount === 'number')
      ? initialRun.orchestratorState.planReviseCount
      : 0;
    // Cached for gate-pending.json shape (skills/plan/SKILL.md:144-146).
    const feature = (initialRun && typeof initialRun.feature === 'string') ? initialRun.feature : '';
    const planPath = join(workDir, 'docs', 'PLAN.md');

    // Step 2: Dispatch planner
    await deps.dispatch('planner', plannerPromptLines(workDir, runId));

    // Step 3: Read plan and check for research section
    const planContent = await deps.readPlanMd();
    const hasResearchNeeded = planContent.includes('### Research needed');

    // Step 4: Dispatch gotcha-checker (and researcher concurrently if needed)
    if (hasResearchNeeded) {
      await Promise.all([
        deps.dispatch('gotcha-checker', gotchaCheckerPromptLines(workDir)),
        deps.dispatch('researcher', researcherPromptLines(workDir)),
      ]);
    } else {
      await deps.dispatch('gotcha-checker', gotchaCheckerPromptLines(workDir));
    }

    // Main review loop — runs once initially, then iterates on REVISE verdicts
    while (true) {
      // Step 5: Clear stale reviewer output before dispatching reviewers
      await deps.clearReviewerOutput(reviewerOutputDir);

      // Step 6: Spawn reviewer-dispatch script to get the reviewer list
      const { stdout } = await deps.spawnScript(
        'scripts/reviewer-dispatch.mjs',
        ['--plan=PLAN.md', '--stage=plan', '--run-id=' + runId],
      );

      let reviewerList;
      try {
        reviewerList = JSON.parse(stdout);
      } catch (_) {
        reviewerList = [];
      }

      // Step 7: Log reviewer list
      writeLog('[orchestrator] reviewers=' + reviewerList.join(','));

      // Step 8: Dispatch each reviewer sequentially
      for (const reviewer of reviewerList) {
        await deps.dispatch(reviewer, reviewerPromptLines(reviewer, workDir, runId));
      }

      // Step 9: Read verdicts
      let hasBlock = false;
      let blockingReviewer = '';
      let hasRevise = false;

      for (const reviewer of reviewerList) {
        const { verdict } = await deps.readReviewerOutput(reviewerOutputDir, reviewer);
        if (verdict === 'BLOCK') {
          hasBlock = true;
          blockingReviewer = reviewer;
          break;
        }
        if (verdict === 'REVISE') {
          hasRevise = true;
        }
      }

      // Step 10: Act on verdicts
      if (hasBlock) {
        await deps.writeGateFile(gatePendingPath, {
          runId,
          gate: 'gate1',
          feature,
          status: 'pending',
          plan: planPath,
          blockedBy: { reviewer: blockingReviewer, reason: 'BLOCK verdict from reviewer' },
        });
        const currentRun = await deps.readRunJson(runJsonPath);
        await deps.writeRunJson(runJsonPath, mergeRun(
          currentRun || {},
          { status: 'gate-pending', gateState: { gate: 'gate1' } },
        ));
        return;
      }

      if (hasRevise) {
        if (M < 2) {
          // Persist incremented counter, preserving sibling orchestratorState fields
          const currentRun = await deps.readRunJson(runJsonPath);
          const currentOrch = (currentRun && currentRun.orchestratorState) ? currentRun.orchestratorState : {};
          const newOrchState = Object.assign({}, currentOrch, { planReviseCount: M + 1 });
          await deps.writeRunJson(runJsonPath, Object.assign({}, currentRun || {}, {
            orchestratorState: newOrchState,
          }));
          M++;

          // Re-dispatch planner with revision-mode prefix
          await deps.dispatch('planner', [
            '[revision-mode: ' + M + ']',
            ...plannerPromptLines(workDir, runId),
          ]);

          // Continue loop to re-dispatch reviewers
          continue;
        } else {
          // M >= 2 — escalate to human via revisingUnresolved gate
          await deps.writeGateFile(gatePendingPath, {
            runId,
            gate: 'gate1',
            feature,
            status: 'pending',
            plan: planPath,
            revisingUnresolved: true,
          });
          const currentRun = await deps.readRunJson(runJsonPath);
          await deps.writeRunJson(runJsonPath, mergeRun(
            currentRun || {},
            { status: 'gate-pending', gateState: { gate: 'gate1' } },
          ));
          return;
        }
      }

      // All APPROVED
      await deps.writeGateFile(gatePendingPath, {
        runId,
        gate: 'gate1',
        feature,
        status: 'pending',
        plan: planPath,
      });
      const currentRun = await deps.readRunJson(runJsonPath);
      await deps.writeRunJson(runJsonPath, mergeRun(
        currentRun || {},
        { status: 'gate-pending', gateState: { gate: 'gate1', status: 'pending' } },
      ));
      return;
    }
  } catch (err) {
    // Mark run failed — best-effort, preserve existing run.json fields via merge.
    // Fail-open: if existing run.json is unreadable, fall back to bare failure write.
    try {
      let currentRun = null;
      try {
        currentRun = await deps.readRunJson(runJsonPath);
      } catch (_) {
        // existing run.json unreadable — fall through to bare write
      }
      const failurePatch = { status: 'failed', failureReason: err.message };
      const dataToWrite = currentRun ? mergeRun(currentRun, failurePatch) : failurePatch;
      await deps.writeRunJson(runJsonPath, dataToWrite);
    } catch (_) {
      // Ignore secondary failure — original error is re-thrown
    }
    throw err;
  }
}
