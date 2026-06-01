// mcp/lib/orchestrator/implement-stage.mjs
// Deterministic implement+apply stage state machine.
// Replaces the prose-following query() path for implement+apply stages when
// FORGE_ORCHESTRATOR_IMPLEMENT=on is set in the environment.
//
// Exit-and-resume defer-gate: the function RETURNS after writing gate2 (no
// internal gate-poll await). On re-invocation with orchestratorState.phase='apply',
// it resumes at the apply step rather than re-dispatching completed phases.

import { join, resolve } from 'node:path';

// Revise cap — mirrors plan-stage.mjs M<2 constraint.
const REVISE_CAP = 2;

/**
 * Tokenize a feature string into unique lowercase words suitable as keywords.
 * Strips punctuation and filters one-character tokens.
 *
 * @param {string} feature
 * @returns {string[]}
 */
function tokenizeFeature(feature) {
  if (!feature) return [];
  return [...new Set(
    feature
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map((t) => t.replace(/^-+|-+$/g, ''))
      .filter((t) => t.length > 1),
  )];
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
 * Validates the orchestratorState shape on resume.
 * Returns a safe state object with expected fields/types.
 *
 * @param {unknown} raw - value from run.json orchestratorState
 * @returns {{ phase: string|null, implementReviseCount: number }}
 */
function validateOrchestratorState(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { phase: null, implementReviseCount: 0 };
  }
  const state = /** @type {Record<string, unknown>} */ (raw);
  const phase = typeof state.phase === 'string' ? state.phase : null;
  const implementReviseCount = typeof state.implementReviseCount === 'number'
    ? state.implementReviseCount
    : 0;
  return { phase, implementReviseCount };
}

/**
 * Prepend injected knowledge text to a prompt lines array.
 * When injected is empty (''), returns the original lines unchanged (no blank header).
 *
 * @param {string} injected - injectable text block or ''
 * @param {string[]} lines - base prompt lines
 * @returns {string[]}
 */
function prependInjection(injected, lines) {
  if (!injected) return lines;
  return [injected, ...lines];
}

/**
 * Prompt lines for coder-scout agent.
 * @param {string} workDir
 * @param {string} runId
 * @returns {string[]}
 */
function coderScoutPromptLines(workDir, runId) {
  return [
    'You are the coder-scout agent.',
    'WorkDir: ' + workDir,
    'RunId: ' + runId,
  ];
}

/**
 * Prompt lines for coder agent.
 * @param {string} workDir
 * @param {string} runId
 * @returns {string[]}
 */
function coderPromptLines(workDir, runId) {
  return [
    'You are the coder agent.',
    'WorkDir: ' + workDir,
    'RunId: ' + runId,
  ];
}

/**
 * Prompt lines for completeness-checker agent.
 * @param {string} workDir
 * @param {string} runId
 * @returns {string[]}
 */
function completenessCheckerPromptLines(workDir, runId) {
  return [
    'You are the completeness-checker agent.',
    'WorkDir: ' + workDir,
    'RunId: ' + runId,
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
    'Stage: implement',
    'WorkDir: ' + workDir,
    'RunId: ' + runId,
  ];
}

/**
 * Prompt lines for applier (documenter) agent.
 * @param {string} workDir
 * @param {string} runId
 * @returns {string[]}
 */
function applierPromptLines(workDir, runId) {
  return [
    'You are the documenter agent.',
    'Stage: apply',
    'WorkDir: ' + workDir,
    'RunId: ' + runId,
  ];
}

// runId validation — prevents path traversal in change-summary write.
const RUN_ID_PATTERN = /^r-[a-zA-Z0-9]+$/;

/**
 * Generate a unique agent ID for stamping run.agents[].
 * @param {string} agentType
 * @returns {string}
 */
function makeAgentId(agentType) {
  return agentType + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

/**
 * Runs the deterministic implement+apply stage orchestration sequence.
 *
 * Exit-and-resume pattern: writes gate2 then RETURNS immediately. On re-invocation
 * with run.json orchestratorState.phase='apply', resumes at the apply step.
 *
 * @param {object} deps - injected dependencies
 * @param {function(string): Promise<object>} deps.readRunJson - reads run.json (path → data)
 * @param {function(string, object): Promise<void>} deps.writeRunJson - writes run.json (path, data)
 * @param {function(string, object): Promise<void>} deps.writeGateFile - writes gate-pending.json
 * @param {function(string?): Promise<void>} deps.clearReviewerOutput - clears reviewer output dir
 * @param {function(string, string): Promise<{verdict: string}>} deps.readReviewerOutput - reads reviewer verdict
 * @param {function(string, string[]): Promise<{stdout: string, exitCode: number}>} deps.spawnScript - spawns a node script
 * @param {function(string, string[]): Promise<object>} deps.dispatch - dispatches an agent (returns {outcome})
 * @param {function(string, string): Promise<void>} [deps.writeChangeSummary] - writes change-summary.md
 * @param {function(string[], string): string} [deps.buildInjectedKnowledge] - optional; returns task-relevant
 *   knowledge text to prepend to agent prompts. Called with (keywords, projectDir). If absent or not a
 *   function, injection is skipped — existing callers without this dep continue to work unchanged.
 * @param {function(string): void} [deps.writeLog] - optional log function
 * @param {string} runId - the run identifier
 * @param {string} workDir - the worktree path
 */
export async function runImplementStageOrchestrator(deps, runId, workDir) {
  const writeLog = deps.writeLog || ((msg) => console.error(msg));

  const runJsonPath = join(workDir, '..', '.pipeline', 'runs', runId, 'run.json');
  const reviewerOutputDir = join(workDir, '.pipeline', 'context', 'reviewer-output');
  const gatePendingPath = join(workDir, '.pipeline', 'gate-pending.json');

  // Derive runsDir from runJsonPath — used for change-summary path (AC-36).
  // runJsonPath = <workDir>/../.pipeline/runs/<runId>/run.json
  // runsDir     = <workDir>/../.pipeline/runs
  const runsDir = join(runJsonPath, '..', '..');

  // Accumulated agents and phases for stamping on run.json.
  // Using arrays that persist across the entire orchestration pass so a single
  // final write carries ALL agent entries (matches observer expectation).
  /** @type {object[]} */
  const allAgents = [];
  /** @type {string[]} */
  const allPhases = [];

  /**
   * Dispatch a single agent, stamp its run.agents[] entry, and persist via writeRunJson.
   * Returns the outcome from the dispatch result.
   *
   * @param {string} agentType
   * @param {string[]} promptLines
   * @returns {Promise<'completed'|'uncertain'>}
   */
  async function stampedDispatch(agentType, promptLines) {
    const agentId = makeAgentId(agentType);
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    const result = await deps.dispatch(agentType, promptLines);

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;
    // Outcome: dispatch returns { outcome } per mock contract; fall back to 'completed'
    // for legacy callers that return only { exitCode, stdout, stderr }.
    const outcome = (result && typeof result.outcome === 'string') ? result.outcome : 'completed';

    const agentEntry = {
      agentId,
      agentType,
      startedAt,
      completedAt,
      durationMs,
      outcome,
    };
    allAgents.push(agentEntry);

    // Persist stamped agents + current phases via writeRunJson.
    const currentRun = await deps.readRunJson(runJsonPath);
    await deps.writeRunJson(runJsonPath, mergeRun(
      currentRun || {},
      { agents: allAgents.slice(), phases: allPhases.slice() },
    ));

    return outcome;
  }

  try {
    // Step 1: Read initial run state and extract orchestratorState
    const initialRun = await deps.readRunJson(runJsonPath);
    const orchState = validateOrchestratorState(
      initialRun && initialRun.orchestratorState
    );

    // Cached for gate2 shape — feature required for observer display.
    const feature = (initialRun && typeof initialRun.feature === 'string')
      ? initialRun.feature
      : '';

    // Gap-1 injection: prepend task-relevant knowledge to agent prompts when
    // deps.buildInjectedKnowledge is provided. Guard: skip silently if absent
    // (preserves AC-4/5/6/7 callers that do not supply this dep).
    let injectedKnowledge = '';
    if (typeof deps.buildInjectedKnowledge === 'function') {
      const keywords = tokenizeFeature(feature);
      // projectDir is the repo root — resolve from workDir (worktree is one level
      // inside the main project's .worktrees/<runId>/ directory, so go up two levels).
      const projectDir = resolve(workDir, '..', '..');
      injectedKnowledge = deps.buildInjectedKnowledge(keywords, projectDir) || '';
    }

    // AC-7: Exit-and-resume defer-gate.
    // If phase is 'apply', skip implement stages and go directly to apply.
    if (orchState.phase === 'apply') {
      writeLog('[orchestrator:implement] resuming at apply phase from orchestratorState');
      await stampedDispatch('documenter', applierPromptLines(workDir, runId));
      return;
    }

    // Step 2: Dispatch coder-scout
    writeLog('[orchestrator:implement] dispatching coder-scout');
    allPhases.push('coder-scout');
    await stampedDispatch('coder-scout', prependInjection(injectedKnowledge, coderScoutPromptLines(workDir, runId)));

    // Step 3: Dispatch coder
    writeLog('[orchestrator:implement] dispatching coder');
    allPhases.push('coder');
    const coderOutcome = await stampedDispatch('coder', prependInjection(injectedKnowledge, coderPromptLines(workDir, runId)));

    // AC-38/AC-35(b): uncertain coder outcome — stamp and surface immediately.
    if (coderOutcome === 'uncertain') {
      const currentRun = await deps.readRunJson(runJsonPath);
      await deps.writeGateFile(gatePendingPath, {
        runId,
        gate: 'gate2',
        feature,
        status: 'pending',
        uncertain: true,
        blockedBy: { agentType: 'coder', reason: 'uncertain outcome — output not verified' },
      });
      await deps.writeRunJson(runJsonPath, mergeRun(
        currentRun || {},
        {
          status: 'gate-pending',
          gateState: { gate: 'gate2', uncertain: true },
          agents: allAgents.slice(),
          phases: allPhases.slice(),
        },
      ));
      return;
    }

    // Step 4: Dispatch completeness-checker
    writeLog('[orchestrator:implement] dispatching completeness-checker');
    allPhases.push('completeness-checker');
    await stampedDispatch('completeness-checker', prependInjection(injectedKnowledge, completenessCheckerPromptLines(workDir, runId)));

    // Reviewer loop — runs once initially, then iterates on REVISE verdicts (capped at M<2)
    let M = orchState.implementReviseCount;

    while (true) {
      // Step 5: Clear stale reviewer output before dispatching reviewers
      await deps.clearReviewerOutput(reviewerOutputDir);

      // Step 6: Spawn reviewer-dispatch script to get the reviewer list
      const { stdout } = await deps.spawnScript(
        'scripts/reviewer-dispatch.mjs',
        ['--stage=implement', '--run-id=' + runId],
      );

      // reviewer-dispatch.mjs returns JSON shape: { reviewers: [...], reasons: [...] }.
      let reviewerList;
      try {
        const parsed = JSON.parse(stdout);
        reviewerList = Array.isArray(parsed && parsed.reviewers) ? parsed.reviewers : [];
      } catch (_) {
        reviewerList = [];
      }

      writeLog('[orchestrator:implement] reviewers=' + reviewerList.join(','));

      // Step 7: Dispatch each reviewer sequentially
      for (const reviewer of reviewerList) {
        allPhases.push(reviewer);
        await stampedDispatch(reviewer, reviewerPromptLines(reviewer, workDir, runId));
      }

      // Step 8: Read verdicts
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

      // Step 9: Act on verdicts

      // AC-6a: BLOCK → gate2 with blockedBy (no auto-fail)
      if (hasBlock) {
        await deps.writeGateFile(gatePendingPath, {
          runId,
          gate: 'gate2',
          feature,
          status: 'pending',
          blockedBy: { reviewer: blockingReviewer, reason: 'BLOCK verdict from reviewer' },
        });
        const currentRun = await deps.readRunJson(runJsonPath);
        await deps.writeRunJson(runJsonPath, mergeRun(
          currentRun || {},
          { status: 'gate-pending', gateState: { gate: 'gate2' }, agents: allAgents.slice(), phases: allPhases.slice() },
        ));
        // AC-7: return immediately — no gate-poll await
        return;
      }

      if (hasRevise) {
        if (M < REVISE_CAP) {
          // Persist incremented revise counter, preserving sibling orchestratorState fields
          const currentRun = await deps.readRunJson(runJsonPath);
          const currentOrch = (currentRun && currentRun.orchestratorState)
            ? currentRun.orchestratorState
            : {};
          const newOrchState = Object.assign({}, currentOrch, { implementReviseCount: M + 1 });
          await deps.writeRunJson(runJsonPath, Object.assign({}, currentRun || {}, {
            orchestratorState: newOrchState,
          }));
          M++;

          // Re-dispatch coder with revision-mode prefix
          allPhases.push('coder-revise-' + M);
          await stampedDispatch('coder', [
            '[revision-mode: ' + M + ']',
            ...coderPromptLines(workDir, runId),
          ]);

          // Continue loop to re-dispatch reviewers
          continue;
        } else {
          // AC-6b: M >= REVISE_CAP — gate2 with revisingUnresolved (no auto-fail)
          await deps.writeGateFile(gatePendingPath, {
            runId,
            gate: 'gate2',
            feature,
            status: 'pending',
            revisingUnresolved: true,
          });
          const currentRun = await deps.readRunJson(runJsonPath);
          await deps.writeRunJson(runJsonPath, mergeRun(
            currentRun || {},
            { status: 'gate-pending', gateState: { gate: 'gate2' }, agents: allAgents.slice(), phases: allPhases.slice() },
          ));
          // AC-7: return immediately — no gate-poll await
          return;
        }
      }

      // AC-5/AC-36: All APPROVED — write change-summary BEFORE gate2.
      if (RUN_ID_PATTERN.test(runId)) {
        const summaryPath = join(runsDir, runId, 'change-summary.md');
        const summaryContent = [
          '# Change Summary',
          '',
          'Feature: ' + feature,
          'RunId: ' + runId,
          'Completed: ' + new Date().toISOString(),
          '',
          '## Agents dispatched',
          ...allAgents.map(a => '- ' + a.agentType + ' (' + a.outcome + ')'),
        ].join('\n');
        if (typeof deps.writeChangeSummary === 'function') {
          await deps.writeChangeSummary(summaryPath, summaryContent);
        }
      } else {
        writeLog('[orchestrator:implement] WARNING: invalid runId "' + runId + '" — skipping change-summary write');
      }

      // AC-5: Write gate2 and persist phase='apply' in orchestratorState
      // so that on re-invocation (after approval) the orchestrator resumes at apply.
      const currentRun = await deps.readRunJson(runJsonPath);
      const currentOrch = (currentRun && currentRun.orchestratorState)
        ? currentRun.orchestratorState
        : {};
      const postGate2OrchState = Object.assign({}, currentOrch, { phase: 'apply' });

      await deps.writeGateFile(gatePendingPath, {
        runId,
        gate: 'gate2',
        feature,
        status: 'pending',
      });

      await deps.writeRunJson(runJsonPath, mergeRun(
        currentRun || {},
        {
          status: 'gate-pending',
          gateState: { gate: 'gate2', status: 'pending' },
          orchestratorState: postGate2OrchState,
          agents: allAgents.slice(),
          phases: allPhases.slice(),
        },
      ));

      // AC-7: return immediately — no gate-poll await
      return;
    }
  } catch (err) {
    // Mark run failed — best-effort, preserve existing run.json fields via merge.
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
