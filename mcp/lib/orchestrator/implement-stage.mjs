// mcp/lib/orchestrator/implement-stage.mjs
// Deterministic implement+apply stage state machine.
// Replaces the prose-following query() path for implement+apply stages when
// FORGE_ORCHESTRATOR_IMPLEMENT=on is set in the environment.
//
// Exit-and-resume defer-gate: the function RETURNS after writing gate2 (no
// internal gate-poll await). On re-invocation with orchestratorState.phase='apply',
// it resumes at the apply step rather than re-dispatching completed phases.

import { join, resolve } from 'node:path';
import { detectMainStrays } from './worktree-guard.mjs';

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
 * @typedef {object} TaskContext
 * @property {string} feature - the feature name from run.json
 * @property {string} activeTasksText - extracted active [ ] task lines + Verify text from PLAN.md
 * @property {number} phaseCount - number of #### Phase N headings in PLAN.md
 */

/**
 * Soak r-15ef051e #2: scope-guard appended to every dispatched agent prompt. Agents
 * self-discover their task by reading in-worktree files; stale per-run artifacts
 * (docs/context/git-diff.txt, handoff.md, prior PLAN.md, .pipeline/context/) caused
 * reviewer-boundary to confabulate a DIFFERENT feature even though its prompt carried the
 * correct Feature + Active tasks. This tells the agent to TRUST the stated scope over
 * anything it self-discovers (GENERAL.md stale-context gotcha — explicit-scope half).
 */
const SCOPE_GUARD =
  'Scope discipline: act ONLY on the Feature and Active tasks stated above, against the ' +
  'actual worktree diff. Do NOT infer or re-scope the feature from docs/context/, handoff.md, ' +
  'git-diff.txt, prior PLAN.md history, .pipeline/context/, or any other in-worktree file — ' +
  'those may be STALE from a prior run. If a file you read disagrees with the stated Feature, ' +
  'trust the stated Feature.';

/**
 * a8de840b #1: worktree-write-confinement, appended to every dispatched agent prompt.
 * The orchestrator binds the SDK `cwd: workDir` but, unlike the skill path, never told
 * agents WHERE to write — and test-author (haiku) leaked its test file into the MAIN
 * project root despite cwd. The non-leaking skill path prepends this exact instruction.
 * This mirrors it so writes stay inside the worktree regardless of how the agent resolves
 * a path (relative, absolute, or via a node/Bash command).
 */
const WRITE_CONFINEMENT =
  'Write discipline: every file you create or modify MUST live under the WorkDir stated ' +
  'above — use absolute paths under WorkDir, or paths relative to it. NEVER create or modify ' +
  'any file in the main project root (the directory two levels above the `.worktrees/` segment ' +
  'of WorkDir), not via a relative path, a computed/derived path, or a `node`/Bash command. ' +
  'All output for this run stays inside WorkDir.';

/**
 * Parse PLAN.md content to extract active tasks and phase count for a given feature.
 * Uses dynamic import for ESM-friendly fs access.
 *
 * @param {string} content - full PLAN.md content
 * @param {string} feature - feature name to match
 * @returns {{ activeTasksText: string, phaseCount: number }}
 */
function parsePlanContent(content, feature) {
  if (!content) return { activeTasksText: '', phaseCount: 0 };

  // Find the ### Feature: section matching this feature.
  const featureHeading = '### Feature:';
  const lines = content.split('\n');

  let inFeatureSection = false;
  let featureSectionStart = -1;

  // Locate the feature section start line.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(featureHeading)) {
      const sectionFeature = lines[i].slice(featureHeading.length).trim();
      if (sectionFeature === feature || (feature && sectionFeature.toLowerCase().includes(feature.toLowerCase()))) {
        inFeatureSection = true;
        featureSectionStart = i;
        break;
      }
    }
  }

  if (!inFeatureSection || featureSectionStart < 0) {
    // No matching feature section — fall back to counting phases in full doc and returning empty tasks.
    const phaseCount = (content.match(/^#{2,4} Phase \d/gm) || []).length;
    return { activeTasksText: '', phaseCount };
  }

  // Collect lines from feature section until next ### heading.
  const sectionLines = [];
  for (let i = featureSectionStart; i < lines.length; i++) {
    if (i > featureSectionStart && lines[i].startsWith('### ')) break;
    sectionLines.push(lines[i]);
  }

  const sectionText = sectionLines.join('\n');

  // Count #### Phase N headings within the section.
  const phaseCount = (sectionText.match(/^#{2,4} Phase \d/gm) || []).length;

  // Extract active [ ] task lines and their Verify:/AC annotations.
  const activeTaskLines = [];
  let i = 0;
  while (i < sectionLines.length) {
    const line = sectionLines[i];
    if (/^\s*-\s*\[\s*\]\s/.test(line)) {
      // Active task line.
      activeTaskLines.push(line.trim());
      // Look ahead for the task's Intent: (the HOW) + Verify:/AC- (the what-to-verify)
      // continuation lines. Soak #6: dropping Intent meant requirements expressed there
      // (e.g. "emit via additionalContext") never reached the coder, which then guessed
      // wrong and got BLOCKed. The ACs alone are not enough to implement from.
      let j = i + 1;
      while (j < sectionLines.length) {
        const next = sectionLines[j];
        if (/^\s*-\s*\[/.test(next)) break; // next task
        if (/^\s*(Intent:|Verify:|AC-\d+:)/.test(next)) {
          activeTaskLines.push(next.trim());
        }
        j++;
      }
    }
    i++;
  }

  const activeTasksText = activeTaskLines.join('\n');
  return { activeTasksText, phaseCount };
}

/**
 * Async version of extractPlanContext using dynamic import (ESM-compatible).
 * PLAN.md lives at `workDir/../docs/PLAN.md` — one level above the worktree.
 * @param {string} workDir
 * @param {string} feature
 * @returns {Promise<{ activeTasksText: string, phaseCount: number }>}
 */
async function extractPlanContextAsync(workDir, feature) {
  try {
    const { readFile } = await import('node:fs/promises');
    const planPath = join(workDir, '..', 'docs', 'PLAN.md');
    const content = await readFile(planPath, 'utf-8');
    return parsePlanContent(content, feature);
  } catch (_) {
    return { activeTasksText: '', phaseCount: 0 };
  }
}

/**
 * Prompt lines for coder-scout agent.
 * @param {string} workDir
 * @param {string} runId
 * @param {TaskContext} taskCtx
 * @returns {string[]}
 */
function coderScoutPromptLines(workDir, runId, taskCtx) {
  const lines = [
    'You are the coder-scout agent.',
    'WorkDir: ' + workDir,
    'RunId: ' + runId,
  ];
  if (taskCtx && taskCtx.feature) {
    lines.push('Feature: ' + taskCtx.feature);
  }
  if (taskCtx && taskCtx.activeTasksText) {
    lines.push('');
    lines.push('Active tasks from PLAN.md:');
    lines.push(taskCtx.activeTasksText);
  }
  lines.push('', SCOPE_GUARD, '', WRITE_CONFINEMENT);
  return lines;
}

/**
 * Prompt lines for test-author agent.
 * test-author writes the red-bar (failing) tests before the coder implements.
 * Does NOT receive [scout-output: — that is the coder's precondition, not test-author's.
 * @param {string} workDir
 * @param {string} runId
 * @param {TaskContext} taskCtx
 * @returns {string[]}
 */
function testAuthorPromptLines(workDir, runId, taskCtx) {
  const lines = [
    'You are the test-author agent.',
    'WorkDir: ' + workDir,
    'RunId: ' + runId,
  ];
  if (taskCtx && taskCtx.feature) {
    lines.push('Feature: ' + taskCtx.feature);
  }
  if (taskCtx && taskCtx.activeTasksText) {
    lines.push('');
    lines.push('Active tasks from PLAN.md:');
    lines.push(taskCtx.activeTasksText);
  }
  lines.push('', SCOPE_GUARD, '', WRITE_CONFINEMENT);
  return lines;
}

/**
 * Prompt lines for coder agent.
 * @param {string} workDir
 * @param {string} runId
 * @param {TaskContext} taskCtx
 * @returns {string[]}
 */
function coderPromptLines(workDir, runId, taskCtx) {
  const lines = [
    'You are the coder agent.',
    'WorkDir: ' + workDir,
    'RunId: ' + runId,
  ];
  if (taskCtx && taskCtx.feature) {
    lines.push('Feature: ' + taskCtx.feature);
  }
  if (taskCtx && taskCtx.activeTasksText) {
    lines.push('');
    lines.push('Active tasks from PLAN.md:');
    lines.push(taskCtx.activeTasksText);
  }
  // AC-3(ii): coder prompt must always include [scout-output: reference.
  lines.push('[scout-output: docs/context/scout.json]');
  // AC-3(iii): [phase-scope: ONLY when plan has ≥2 Phase headings.
  if (taskCtx && taskCtx.phaseCount >= 2) {
    lines.push('[phase-scope: ' + taskCtx.feature + ']');
  }
  lines.push('', SCOPE_GUARD, '', WRITE_CONFINEMENT);
  return lines;
}

/**
 * Prompt lines for completeness-checker agent.
 * @param {string} workDir
 * @param {string} runId
 * @param {TaskContext} taskCtx
 * @returns {string[]}
 */
function completenessCheckerPromptLines(workDir, runId, taskCtx) {
  const lines = [
    'You are the completeness-checker agent.',
    'WorkDir: ' + workDir,
    'RunId: ' + runId,
  ];
  if (taskCtx && taskCtx.feature) {
    lines.push('Feature: ' + taskCtx.feature);
  }
  if (taskCtx && taskCtx.activeTasksText) {
    lines.push('');
    lines.push('Active tasks from PLAN.md:');
    lines.push(taskCtx.activeTasksText);
  }
  lines.push('', SCOPE_GUARD, '', WRITE_CONFINEMENT);
  return lines;
}

/**
 * Prompt lines for a reviewer agent.
 * @param {string} reviewerType
 * @param {string} workDir
 * @param {string} runId
 * @param {TaskContext} taskCtx
 * @returns {string[]}
 */
function reviewerPromptLines(reviewerType, workDir, runId, taskCtx) {
  const lines = [
    'You are the ' + reviewerType + ' agent.',
    'Stage: implement',
    'WorkDir: ' + workDir,
    'RunId: ' + runId,
  ];
  if (taskCtx && taskCtx.feature) {
    lines.push('Feature: ' + taskCtx.feature);
  }
  if (taskCtx && taskCtx.activeTasksText) {
    lines.push('');
    lines.push('Active tasks from PLAN.md:');
    lines.push(taskCtx.activeTasksText);
  }
  lines.push('', SCOPE_GUARD, '', WRITE_CONFINEMENT);
  return lines;
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
  /** @type {Array<{index: number, label: string, status: string}>} */
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
    const startedAt = Date.now();
    const startMs = startedAt;

    const result = await deps.dispatch(agentType, promptLines);

    const completedAt = Date.now();
    const durationMs = completedAt - startMs;
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

    // Extract active task context from docs/PLAN.md. Read via the injected
    // deps.readPlanMd (main-root resolved) — NOT path arithmetic off workDir:
    // docs/PLAN.md is UNTRACKED so it lives only at the main project root, never
    // in the worktree checkout (GENERAL.md gotcha #3 — deps resolve paths, the
    // orchestrator must not do its own worktree-relative path math).
    let planContent = '';
    if (typeof deps.readPlanMd === 'function') {
      try { planContent = (await deps.readPlanMd()) || ''; } catch (_) { planContent = ''; }
    }
    const { activeTasksText, phaseCount } = parsePlanContent(planContent, feature);
    /** @type {TaskContext} */
    const taskCtx = { feature, activeTasksText, phaseCount };

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

    // a8de840b #2: snapshot MAIN's untracked strays BEFORE any dispatch, so the
    // post-writer check flags only files an agent freshly wrote into main (not the
    // pre-existing untracked files main always carries). null = dep absent → no-op.
    const strayBaseline = typeof deps.snapshotMainStrays === 'function'
      ? (await deps.snapshotMainStrays())
      : null;

    // Step 2: Dispatch coder-scout
    writeLog('[orchestrator:implement] dispatching coder-scout');
    allPhases.push({ index: allPhases.length, label: 'coder-scout', status: 'completed' });
    const scoutOutcome = await stampedDispatch('coder-scout', prependInjection(injectedKnowledge, coderScoutPromptLines(workDir, runId, taskCtx)));

    // G8: enforce the scout precondition — the coder MUST NOT run without verified scout
    // output (CLAUDE.md coder-dispatch discipline). An uncertain coder-scout (e.g. absent or
    // degenerate scout.json) blocks gate2 rather than dispatching a coder with no file map.
    if (scoutOutcome === 'uncertain') {
      const currentRun = await deps.readRunJson(runJsonPath);
      await deps.writeGateFile(gatePendingPath, {
        runId, gate: 'gate2', feature, status: 'pending', uncertain: true,
        blockedBy: { agentType: 'coder-scout', reason: 'scout output not verified — coder precondition unmet' },
      });
      await deps.writeRunJson(runJsonPath, mergeRun(currentRun || {}, {
        status: 'gate-pending', gateState: { gate: 'gate2', uncertain: true },
        agents: allAgents.slice(), phases: allPhases.slice(),
      }));
      return;
    }

    // Step 3: Dispatch test-author (writes red-bar tests before coder implements)
    writeLog('[orchestrator:implement] dispatching test-author');
    allPhases.push({ index: allPhases.length, label: 'test-author', status: 'completed' });
    const testAuthorOutcome = await stampedDispatch('test-author', prependInjection(injectedKnowledge, testAuthorPromptLines(workDir, runId, taskCtx)));

    // G7/G8: consume the test-author outcome (G7 gave it a real expectedArtifact, so
    // 'uncertain' now means its red-bar artifact was not verifiably written). The coder
    // MUST NOT implement against an unverified red bar — that defeats TDD and risks a
    // Red+Green collapse. Block gate2 instead, parallel to the scout precondition.
    if (testAuthorOutcome === 'uncertain') {
      const currentRun = await deps.readRunJson(runJsonPath);
      await deps.writeGateFile(gatePendingPath, {
        runId, gate: 'gate2', feature, status: 'pending', uncertain: true,
        blockedBy: { agentType: 'test-author', reason: 'red-bar tests not verified — coder TDD precondition unmet' },
      });
      await deps.writeRunJson(runJsonPath, mergeRun(currentRun || {}, {
        status: 'gate-pending', gateState: { gate: 'gate2', uncertain: true },
        agents: allAgents.slice(), phases: allPhases.slice(),
      }));
      return;
    }

    // Step 4: Dispatch coder
    writeLog('[orchestrator:implement] dispatching coder');
    allPhases.push({ index: allPhases.length, label: 'coder', status: 'completed' });
    const coderOutcome = await stampedDispatch('coder', prependInjection(injectedKnowledge, coderPromptLines(workDir, runId, taskCtx)));

    // a8de840b #2: structural backstop — after the writer agents (test-author + coder),
    // detect any file a dispatched agent wrote into MAIN, outside the worktree. Mechanism-
    // independent (catches the breach however the path was computed). #1 (WRITE_CONFINEMENT)
    // prevents it; this surfaces a leak loudly so it never reaches a clean regression silently.
    if (strayBaseline !== null) {
      const strays = detectMainStrays(strayBaseline, await deps.snapshotMainStrays());
      if (strays.length) {
        writeLog('[worktree-escape] dispatched agent wrote into MAIN outside the worktree: '
          + strays.join(', ') + ' — worktree-isolation breach (a8de840b). Remove from main before any regression.');
      }
    }

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

    // Step 4b: Deterministic test verification — run ONLY the covering tests for
    // the coder's changed files (resolved via the @covers map), through
    // scripts/covers-verify.mjs, OFF the coder's turn budget. The coder no longer
    // runs the full suite itself: in r-77a6fac8 that exhausted its turn budget on
    // worktree SDK-dependency test noise before it could write handoff.md, leaving
    // the coder 'uncertain'. A failing covering test blocks gate2 (parallel to the
    // uncertain-coder defer) instead of proceeding to completeness-checker/reviewers.
    writeLog('[orchestrator:implement] running covers-verify');
    const coversResult = await deps.spawnScript(
      'scripts/covers-verify.mjs',
      ['--changed-from-git', '--root=' + workDir],
    );
    if (coversResult && coversResult.exitCode !== 0) {
      const currentRun = await deps.readRunJson(runJsonPath);
      await deps.writeGateFile(gatePendingPath, {
        runId,
        gate: 'gate2',
        feature,
        status: 'pending',
        uncertain: true,
        blockedBy: { agentType: 'covers-verify', reason: 'covering tests failed' },
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
    allPhases.push({ index: allPhases.length, label: 'completeness-checker', status: 'completed' });
    const completenessOutcome = await stampedDispatch('completeness-checker', prependInjection(injectedKnowledge, completenessCheckerPromptLines(workDir, runId, taskCtx)));

    // G3: consume the completeness verdict. completeness-checker is readonly (judged by its
    // [completeness-ok] signal); 'uncertain' = it did NOT confirm the handoff covers all plan
    // tasks → block gate2 instead of proceeding to reviewers on a possibly-incomplete impl.
    if (completenessOutcome === 'uncertain') {
      const currentRun = await deps.readRunJson(runJsonPath);
      await deps.writeGateFile(gatePendingPath, {
        runId, gate: 'gate2', feature, status: 'pending', uncertain: true,
        blockedBy: { agentType: 'completeness-checker', reason: 'completeness not confirmed — handoff may not cover all plan tasks' },
      });
      await deps.writeRunJson(runJsonPath, mergeRun(currentRun || {}, {
        status: 'gate-pending', gateState: { gate: 'gate2', uncertain: true },
        agents: allAgents.slice(), phases: allPhases.slice(),
      }));
      return;
    }

    // Reviewer loop — runs once initially, then iterates on REVISE verdicts (capped at M<2)
    let M = orchState.implementReviseCount;

    while (true) {
      // Step 5: Clear stale reviewer output before dispatching reviewers
      await deps.clearReviewerOutput(reviewerOutputDir);

      // Step 6: Spawn reviewer-dispatch script to get the reviewer list.
      // G2: thread the real worktree diff (incl. untracked test files) via --tests-diff
      // so the dispatcher's addReviewerTestsIfNeeded force-include fires reviewer-tests on
      // test-touching changes. Without it, reviewer-dispatch falls to handoff-PROSE
      // classification where the force-include never runs (and the test-author's NEW test
      // files aren't in the coder's handoff anyway). Fail-open: null path → no flag → the
      // prior handoff-only behavior.
      const reviewDiffPath = typeof deps.buildReviewDiff === 'function'
        ? await deps.buildReviewDiff(workDir)
        : null;
      const reviewerDispatchArgs = ['--stage=implement', '--run-id=' + runId];
      if (reviewDiffPath) reviewerDispatchArgs.push('--tests-diff=' + reviewDiffPath);
      const { stdout } = await deps.spawnScript('scripts/reviewer-dispatch.mjs', reviewerDispatchArgs);

      // reviewer-dispatch.mjs returns JSON shape: { reviewers: [...], reasons: [...] }.
      let reviewerList;
      try {
        const parsed = JSON.parse(stdout);
        reviewerList = Array.isArray(parsed && parsed.reviewers) ? parsed.reviewers : [];
      } catch (_) {
        // G5: unparseable reviewer-dispatch output = its selection FAILED. Do NOT treat that
        // as "0 reviewers" (which would silently reach a clean gate2 with zero review). Block
        // gate2 so the failure surfaces, never proceed unreviewed.
        const currentRun = await deps.readRunJson(runJsonPath);
        await deps.writeGateFile(gatePendingPath, {
          runId, gate: 'gate2', feature, status: 'pending', uncertain: true,
          blockedBy: { agentType: 'reviewer-dispatch', reason: 'reviewer selection failed — unparseable reviewer-dispatch output' },
        });
        await deps.writeRunJson(runJsonPath, mergeRun(currentRun || {}, {
          status: 'gate-pending', gateState: { gate: 'gate2', uncertain: true },
          agents: allAgents.slice(), phases: allPhases.slice(),
        }));
        return;
      }

      writeLog('[orchestrator:implement] reviewers=' + reviewerList.join(','));

      // Step 7: Dispatch each reviewer sequentially
      for (const reviewer of reviewerList) {
        allPhases.push({ index: allPhases.length, label: reviewer, status: 'completed' });
        await stampedDispatch(reviewer, reviewerPromptLines(reviewer, workDir, runId, taskCtx));
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
          allPhases.push({ index: allPhases.length, label: 'coder-revise-' + M, status: 'completed' });
          await stampedDispatch('coder', [
            '[revision-mode: ' + M + ']',
            ...coderPromptLines(workDir, runId, taskCtx),
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

      // 94302649: commit the worktree source BEFORE gate2 — ONLY on the all-APPROVED
      // path (the only branch that sets phase='apply' / flows to merge). A BLOCK or
      // unresolved-revise is a stop-for-the-human state and is intentionally NOT
      // committed here — the gate surfaces the problem and the human fixes via re-run.
      if (typeof deps.commitWorktree === 'function') {
        const safeFeature = (feature || '').replace(/[\r\n]/g, ' ').trim();
        const commitResult = await deps.commitWorktree(workDir, 'feat(forge): ' + safeFeature + ' [' + runId + ']');
        if (commitResult && commitResult.committed === false) {
          writeLog('[orchestrator:implement] worktree commit skipped: ' + (commitResult.reason || 'unknown'));
        }
      } else {
        writeLog('[orchestrator:implement] WARNING: deps.commitWorktree not wired — worktree source NOT committed; the zero-commit merge guard will refuse this run (data-loss risk). Wire deps.commitWorktree in forge-worker.mjs.');
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
