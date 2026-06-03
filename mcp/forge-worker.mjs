import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, writeFileSync, existsSync, unlinkSync, openSync, writeSync, closeSync, mkdirSync, readdirSync, watchFile, unwatchFile } from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { workerLogPath, killPillPath, resetPillPath } from './lib/worker-paths.js';
import { stampOrphanAgents } from './lib/stamp-orphan-agents.js';
import { consumeGateApproval } from './lib/gate-helpers.js';
import { evaluateBudget, proactiveInterruptStep } from './lib/proactive-interrupt.mjs';
import buildInProcessMcpServer from './forge-worker-mcp.mjs';
import { WORKER_TIMEOUT_MS, parseGatePollTimeout, buildGatePollFailureReason, parseEscalationTimeout } from './lib/worker-timeouts.js';

// Context-budget monitoring constants — aligned with ctx-post-tool.js THRESHOLD_WARNING (35% remaining = 65% consumed).
// Worker triggers bridge write at 70% consumed (30% remaining) so the subagent has ample lead time.
const BUDGET_THRESHOLD_CONSUMED = 0.70; // 70% consumed triggers bridge write
const BUDGET_INTERRUPT_THRESHOLD = 0.85; // ≥ BUDGET_THRESHOLD_CONSUMED — triggers proactive interrupt
const BUDGET_CONTEXT_WINDOW = 200_000;  // denominator for all dispatched models (V1: fixed)
const BUDGET_AUTOCOMPACT_FACTOR = 0.835; // mirrors ctx-session-start.js
const BUDGET_DEBOUNCE_MS = 30_000;      // write bridge at most once per 30 s per agent

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Mirrors mcp/server.js resolveMainProjectDir logic.
 * Reads .git to detect whether the cwd is a worktree; if so, returns the
 * main repo root. Falls through on EISDIR (normal .git directory) or ENOENT
 * (no .git at all) — returns projectDir unchanged in those cases.
 *
 * IMPORTANT: This function performs blocking I/O and MUST be called exactly
 * once at worker startup. The result is cached in resolvedMainProjectRoot
 * (module scope) and must NOT be called per-tick inside the watchFile poll
 * loops (which fire every 1000 ms) to avoid blocking I/O on every interval.
 *
 * @param {string} projectDir - The worker's working directory (process.cwd()).
 * @returns {string} The main project root, or projectDir if not a worktree.
 */
function resolveMainProjectRoot(projectDir) {
  const gitFile = join(projectDir, '.git');
  try {
    const content = readFileSync(gitFile, 'utf8').trim();
    if (content.startsWith('gitdir:')) {
      const gitdir = content.replace('gitdir:', '').trim();
      const match = gitdir.match(/(.+)[/\\]\.git[/\\]worktrees[/\\]/);
      if (match) return resolve(match[1]);
      // gitdir present but pattern did not match — fall through to return projectDir
    }
  } catch (err) {
    if (err.code !== 'EISDIR' && err.code !== 'ENOENT') {
      process.stderr.write('[forge-worker] .git read failed: ' + err.message + '\n');
    }
    // EISDIR = normal .git directory (not a worktree file), ENOENT = no .git at all
    // Both are expected non-worktree cases — fall through
  }
  return projectDir;
}

function findWorkerTaskFile(dir) {
  const pipelineDir = join(dir, '.pipeline');
  const runId = process.env.FORGE_WORKER_RUN_ID;
  try {
    const entries = readdirSync(pipelineDir);
    if (runId) {
      // Targeted: accept only the file for this exact run
      const specific = 'worker-task-' + runId + '.json';
      return entries.includes(specific) ? join(pipelineDir, specific) : null;
    }
    // Fallback: lex-first (legacy / single-worker runs)
    const match = entries.find((e) => /^worker-task-.+\.json$/.test(e));
    return match ? join(pipelineDir, match) : null;
  } catch {
    return null;
  }
}

/**
 * Creates a controllable async iterable channel for SDKUserMessage objects.
 * push() queues a message; close() signals no more messages.
 * The async iterator yields pushed messages and awaits when the queue is empty.
 */
function createMessageChannel() {
  const queue = [];
  let resolve = null;
  let closed = false;

  return {
    push(msg) {
      if (closed) return;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
    },
    close() {
      closed = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined, done: true });
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((r) => { resolve = r; });
        },
      };
    },
  };
}

async function main() {
  let taskData;
  try {
    const taskPath = findWorkerTaskFile(process.cwd());
    if (!taskPath) throw new Error('no worker-task-*.json found in .pipeline/');
    const raw = readFileSync(taskPath, 'utf-8');
    taskData = JSON.parse(raw);
  } catch (err) {
    process.stderr.write('[forge-worker] failed to read worker-task: ' + err.message + '\n');
    process.exit(1);
  }

  const { runId, feature, pipelineType } = taskData;

  if (!runId || !feature || !pipelineType) {
    process.stderr.write('[forge-worker] worker-task.json missing required fields (runId, feature, pipelineType)\n');
    process.exit(1);
  }

  const workDir = process.cwd();
  // Resolve main project root once at startup — cached here for use across all
  // path computations. Must NOT be re-invoked inside watchFile callbacks (1000 ms
  // poll) to avoid blocking I/O on every tick.
  const resolvedMainProjectRoot = resolveMainProjectRoot(workDir);
  const safeFeature = feature.replace(/["\\`$\r\n\x00-\x1f]/g, ' ').trim();
  const prompt = 'You are a FORGE pipeline worker. Your runId is ' + runId + '. ' +
    'Execute /forge:' + pipelineType + ' for feature: ' + safeFeature + '. ' +
    'IMPORTANT: The run has already been created and the worker has been spawned. ' +
    'Skip STEP 1 (dispatch worker) — start from STEP 2.';

  const logFile = workerLogPath(resolvedMainProjectRoot, runId);
  const logDir = join(resolvedMainProjectRoot, '.pipeline', 'worker-logs');
  let logFd;
  try {
    mkdirSync(logDir, { recursive: true });
    logFd = openSync(logFile, 'a');
  } catch (err) {
    process.stderr.write('[forge-worker] failed to open log file: ' + err.message + '\n');
    process.exit(1);
  }

  const writeLog = (line) => {
    try {
      writeSync(logFd, line + '\n');
    } catch (_) {
      // non-fatal — log write failure should not abort the pipeline
    }
  };

  writeLog('[forge-worker] starting run ' + runId + ' feature=' + safeFeature + ' type=' + pipelineType);

  // Active-worker safety valve — 60 minutes (WORKER_TIMEOUT_MS from worker-timeouts.js).
  // Gate-poll timeout — 6 h default, env-overridable via FORGE_WORKER_GATE_TIMEOUT_MS
  // (GATE_POLL_TIMEOUT_DEFAULT_MS; validated by parseGatePollTimeout).
  // The two timeouts serve different purposes and are now decoupled:
  //   WORKER_TIMEOUT_MS       — active pipeline budget (per phase, reset by per-phase pill)
  //   GATE_POLL_TIMEOUT_MS    — wait budget while gate is pending (human review time)
  const GATE_POLL_TIMEOUT_MS = parseGatePollTimeout(process.env.FORGE_WORKER_GATE_TIMEOUT_MS);
  const ESCALATION_POLL_TIMEOUT_MS = parseEscalationTimeout(process.env.FORGE_WORKER_ESCALATION_TIMEOUT_MS);
  let workerTimedOut = false;
  let workerTimer = setTimeout(() => {
    workerTimedOut = true;
    writeLog('[forge-worker] active-worker timeout reached (' + WORKER_TIMEOUT_MS + ' ms) — aborting');
  }, WORKER_TIMEOUT_MS);
  workerTimer.unref();

  /**
   * Clears the existing safety-valve timer and starts a fresh window.
   *
   * @param {number} [timeoutMs=WORKER_TIMEOUT_MS] - Timer duration in ms.
   *   Pass GATE_POLL_TIMEOUT_MS when entering gate-pending so the gate-poll
   *   budget is independent of the active-worker budget.
   *   Omit (or pass WORKER_TIMEOUT_MS) for per-phase resets and post-approval
   *   resumption — those use the active-worker safety valve.
   */
  function resetWorkerTimer(timeoutMs = WORKER_TIMEOUT_MS) {
    clearTimeout(workerTimer);
    workerTimedOut = false;
    const setAt = Date.now();
    writeLog('[forge-worker] [timer-reset] timeoutMs=' + timeoutMs + ' set-at=' + setAt);
    workerTimer = setTimeout(() => {
      workerTimedOut = true;
      const elapsed = Date.now() - setAt;
      writeLog('[forge-worker] timeout reached (' + timeoutMs + ' ms) — aborting elapsed-since-set=' + elapsed);
    }, timeoutMs);
    workerTimer.unref();
  }

  // Poison-pill: conductor writes .pipeline/worker-kill/<runId> in the MAIN project
  // root to request graceful stop. Must use resolvedMainProjectRoot so this matches
  // the path that forge_kill_worker writes — using workDir here would silently miss
  // the signal in worktree-backed runs (worktree path !== main project root).
  let poisonPillDetected = false;
  const pillPath = killPillPath(resolvedMainProjectRoot, runId);
  watchFile(pillPath, { interval: 1000 }, () => {
    if (existsSync(pillPath)) {
      poisonPillDetected = true;
    }
  });

  // Per-phase timer reset: the implement skill writes .pipeline/worker-reset/<runId>
  // inside the WORKTREE (workDir) after each phase commit. The worker resets its
  // safety-valve timer so a phased run gets a fresh budget per phase instead of one
  // shared 60-min ceiling. Reset-pill stays in the worktree intentionally — the skill
  // always operates inside the worktree. Same watchFile pattern as the poison-pill.
  const resetPath = resetPillPath(workDir, runId);
  watchFile(resetPath, { interval: 1000 }, () => {
    if (existsSync(resetPath)) {
      try { unlinkSync(resetPath); } catch (_) { /* fall through — best effort */ }
      resetWorkerTimer();
      writeLog('[forge-worker] per-phase timer reset');
    }
  });

  /**
   * Reads run.json for the current run. Returns parsed object or null.
   * Never throws — fail-open so a missing registry does not abort the worker.
   * Reads from resolvedMainProjectRoot so worktree workers share the single
   * main-root run registry instead of reading worktree-scattered copies.
   */
  function readRunData() {
    try {
      const runPath = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
      return JSON.parse(readFileSync(runPath, 'utf-8'));
    } catch (_) {
      return null;
    }
  }

  /**
   * Reads run-active.json for the current run. Returns parsed object or null.
   * Never throws — fail-open so a missing file does not abort the worker.
   * Reads from the WORKTREE (workDir) because subagent-stop.js writes it there.
   */
  function readRunActiveData() {
    try {
      const p = join(workDir, '.pipeline', 'runs', runId, 'run-active.json');
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch (_) {
      return null;
    }
  }

  /**
   * Polls a gate file until its status is 'approved' or 'discarded' for the
   * EXPECTED gate name, or until the worker timeout fires.
   *
   * The gate-name check is defence against stale gate-pending.json content:
   * if a prior phase's approved file is left on disk (e.g. gate1/approved
   * persisting while the worker now waits for gate2), the status field would
   * read 'approved' but the gate name would not match — so we keep polling
   * instead of auto-resolving. See TODO 9a9d29b2 — observed gate2 auto-skip
   * on r-7299690b 2026-05-09.
   *
   * Uses watchFile (stat-polling, cross-platform) for change detection,
   * with a 3 s setInterval fallback to guard against missed events.
   * Resolves with 'approved', 'discarded', or 'timeout'.
   */
  function waitForGateDecision(gatePath, expectedGate) {
    return new Promise((resolve) => {
      let resolved = false;

      function checkGate() {
        if (resolved) return;
        if (workerTimedOut) {
          resolved = true;
          cleanup();
          resolve('timeout');
          return;
        }
        if (poisonPillDetected) {
          resolved = true;
          cleanup();
          resolve('discarded');
          return;
        }
        try {
          const raw = readFileSync(gatePath, 'utf-8');
          const gate = JSON.parse(raw);
          // Defence: file's gate name must match the gate we are waiting for.
          // Wrong-gate or stale content → keep polling.
          if (gate.gate !== expectedGate) {
            return;
          }
          if (gate.status === 'approved') {
            resolved = true;
            cleanup();
            resolve('approved');
          } else if (gate.status === 'discarded') {
            resolved = true;
            cleanup();
            resolve('discarded');
          }
        } catch (_) {
          // Gate file not yet written or temporarily unreadable — keep polling
        }
      }

      let interval;
      function cleanup() {
        clearInterval(interval);
        unwatchFile(gatePath);
      }

      // setInterval fallback: poll every 3 s regardless of fs events
      interval = setInterval(checkGate, 3000);

      // watchFile fires on mtime/size change — more efficient than tight loops.
      // interval: 1000 ms stat poll cadence for watchFile itself.
      watchFile(gatePath, { interval: 1000 }, checkGate);

      // Check immediately in case the gate is already decided before we start watching
      checkGate();
    });
  }

  /**
   * Polls for an escalation response file matching <runId>-*.response.json
   * in the escalations directory. Resolves with the parsed response object when
   * found, 'timeout' on escalation-poll timeout, or 'discarded' on poison-pill.
   *
   * Fail-open: malformed JSON or missing required fields are logged via writeLog
   * with the [escalation-response-malformed] prefix and treated as absent —
   * polling continues rather than aborting the worker.
   *
   * @param {string} escDir - Path to the escalations directory (main project root).
   * @returns {Promise<{escalationId: string, response: string}|'timeout'|'discarded'>}
   */
  function waitForEscalationResponse(escDir) {
    return new Promise((resolve) => {
      let resolved = false;

      function checkResponse() {
        if (resolved) return;
        if (workerTimedOut) {
          resolved = true;
          cleanup();
          resolve('timeout');
          return;
        }
        if (poisonPillDetected) {
          resolved = true;
          cleanup();
          resolve('discarded');
          return;
        }
        try {
          const files = readdirSync(escDir);
          const responseFile = files.find(
            (f) => f.startsWith(runId + '-') && f.endsWith('.response.json'),
          );
          if (responseFile) {
            const respPath = join(escDir, responseFile);
            try {
              const raw = readFileSync(respPath, 'utf-8');
              const data = JSON.parse(raw);
              if (!data || typeof data.escalationId !== 'string' || typeof data.response !== 'string') {
                writeLog('[escalation-response-malformed] ' + respPath + ' — missing escalationId or response fields; continuing poll');
                return; // fail-open: treat as absent, keep polling
              }
              try { unlinkSync(respPath); } catch (_) {}
              resolved = true;
              cleanup();
              resolve({ escalationId: data.escalationId, response: data.response });
            } catch (parseErr) {
              writeLog('[escalation-response-malformed] ' + respPath + ' — ' + parseErr.message + '; continuing poll');
              // fail-open: malformed JSON — keep polling
            }
          }
        } catch (_) {
          // escDir not yet created or unreadable — keep polling
        }
      }

      let interval;
      function cleanup() {
        clearInterval(interval);
      }

      // Poll every 3 s (same cadence as gate-poll fallback interval)
      interval = setInterval(checkResponse, 3000);
      // Check immediately in case a response file is already present
      checkResponse();
    });
  }

  /**
   * Polls for a loop-guard sidecar file to be ABSENT (deleted by the hook
   * after the user resolves the blocked state). Resolves with:
   *   'cleared'   — sidecar file is gone (normal resume path)
   *   'timeout'   — gate-poll timeout fired while waiting
   *   'discarded' — poison-pill detected
   *
   * @param {string} sidecarPath - Path to the loop-guard-blocked.json sidecar file.
   * @returns {Promise<'cleared'|'timeout'|'discarded'>}
   */
  function waitForLoopGuardClear(sidecarPath) {
    return new Promise((resolve) => {
      let resolved = false;

      function checkSidecar() {
        if (resolved) return;
        if (workerTimedOut) {
          resolved = true;
          cleanup();
          resolve('timeout');
          return;
        }
        if (poisonPillDetected) {
          resolved = true;
          cleanup();
          resolve('discarded');
          return;
        }
        if (!existsSync(sidecarPath)) {
          resolved = true;
          cleanup();
          resolve('cleared');
        }
      }

      let interval;
      function cleanup() {
        clearInterval(interval);
        try { unwatchFile(sidecarPath); } catch (_) {}
      }

      interval = setInterval(checkSidecar, 3000);
      watchFile(sidecarPath, { interval: 1000 }, checkSidecar);
      checkSidecar();
    });
  }

  // Debounce tracking for terminal-status poll — updated each time readRunData()
  // is called in the per-message loop. Initialised to 0 so the first message
  // always triggers a check (Date.now() - 0 >> 500).
  let lastStatusReadAt = 0;

  let exitCode = 0;
  const inputChannel = createMessageChannel();
  inputChannel.push({
    type: 'user',
    message: { role: 'user', content: prompt },
    parent_tool_use_id: null,
  });

  // Last-resort crash containment for in-process MCP tool throws.
  // The shim wraps every handler in try/catch (primary net); this handler
  // catches anything that escapes into the worker event loop. Log and continue.
  process.on('uncaughtException', (err) => {
    const msg = err && err.message ? err.message : String(err);
    writeLog('[forge-worker] uncaughtException: ' + msg);
    process.stderr.write('[forge-worker] uncaughtException: ' + msg + '\n');
  });

  // Set env vars required by in-process MCP tools BEFORE query() initialises
  // the SDK server. These were previously set only on the stdio subprocess env.
  // FORGE_WORKER_SESSION: recursion guard at run-lifecycle.js:296,1132
  // CLAUDE_PROJECT_DIR: project-dir resolver at shared.js:47 (belt-and-braces)
  // CLAUDE_CODE_STREAM_CLOSE_TIMEOUT: lift SDK MCP 60s default to 300s (sdk.d.ts:419)
  process.env.FORGE_WORKER_SESSION = '1';
  process.env.CLAUDE_PROJECT_DIR = workDir;
  process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

  // One-level merge for run.json objects — preserves orchestratorState sibling fields.
  function mergeRunJson(current, patch) {
    const merged = Object.assign({}, current, patch);
    if (patch.orchestratorState != null || current.orchestratorState != null) {
      merged.orchestratorState = Object.assign(
        {}, current.orchestratorState ?? {}, patch.orchestratorState ?? {}
      );
    }
    return merged;
  }

  try {
    // --- Deterministic orchestrator path (plan stage only) ---
    if (process.env.FORGE_ORCHESTRATOR_PLAN === 'on' && pipelineType === 'plan') {
      const { runPlanStageOrchestrator } = await import('./lib/orchestrator/plan-stage.mjs');
      const { dispatchAgent } = await import('./lib/orchestrator/agent-dispatch.mjs');
      const { parseReviewerVerdict } = await import('./lib/orchestrator/reviewer-verdict.mjs');
      const buildMcpServer = (await import('./forge-worker-mcp.mjs')).default;

      const orchDeps = {
        dispatch: (agentType, promptLines) => dispatchAgent({
          agentType, promptLines, workDir, pluginRoot,
          buildMcpServer,
        }),
        spawnScript: async (scriptPath, args) => {
          const { spawn } = await import('node:child_process');
          return new Promise((res, rej) => {
            const child = spawn(process.execPath, [scriptPath, ...args], { cwd: workDir });
            let out = '';
            child.stdout.on('data', (d) => { out += d; });
            child.on('close', (code) => res({ stdout: out, exitCode: code }));
            child.on('error', rej);
          });
        },
        readPlanMd: () => readFileSync(join(workDir, 'docs', 'PLAN.md'), 'utf-8'),
        clearReviewerOutput: async () => {
          const dir = join(workDir, '.pipeline', 'context', 'reviewer-output');
          try {
            for (const f of readdirSync(dir)) {
              if (f.endsWith('.md')) unlinkSync(join(dir, f));
            }
          } catch (_) { /* dir absent — no-op */ }
        },
        readRunJson: (_path) => {
          const p = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
          return JSON.parse(readFileSync(p, 'utf-8'));
        },
        writeRunJson: async (_path, data) => {
          const p = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
          writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8');
        },
        writeGateFile: async (_path, content) => {
          writeFileSync(
            join(workDir, '.pipeline', 'gate-pending.json'),
            JSON.stringify(content, null, 2) + '\n', 'utf-8'
          );
        },
        readReviewerOutput: async (reviewerOutputDir, reviewerName) => {
          try {
            const content = readFileSync(join(reviewerOutputDir, reviewerName + '.md'), 'utf-8');
            // Robust: anchor on the "### Verdict" section, fail-safe BLOCK-wins. The old
            // first-line-only match silently dropped a BLOCK on a later line (soak #1).
            return { verdict: parseReviewerVerdict(content) };
          } catch (_) {
            // G4: a missing/unreadable verdict file means the reviewer crashed, truncated,
            // or timed out before writing. Treat as NO-VERDICT → REVISE (matches the skill
            // path's no-verdict→REVISE-unresolved handling). NEVER default to APPROVED —
            // that silently passes a dead reviewer straight through gate2.
            return { verdict: 'REVISE' };
          }
        },
        writeLog,
      };

      try {
        await runPlanStageOrchestrator(orchDeps, runId, workDir);
      } catch (err) {
        writeLog('[forge-worker] orchestrator error: ' + err.message);
        exitCode = 1;
      }

      if (exitCode === 0) {
        const gatePath = join(workDir, '.pipeline', 'gate-pending.json');
        const decision = await waitForGateDecision(gatePath, 'gate1');
        writeLog('[forge-worker] orchestrator gate1 decision: ' + decision);
        if (decision === 'approved') {
          consumeGateApproval(gatePath, 'gate1');
          resetWorkerTimer();
        } else if (decision === 'timeout') {
          try {
            const runPath = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
            const runObj = JSON.parse(readFileSync(runPath, 'utf-8'));
            runObj.status = 'failed';
            runObj.failureReason = buildGatePollFailureReason('gate1', GATE_POLL_TIMEOUT_MS);
            writeFileSync(runPath, JSON.stringify(runObj, null, 2) + '\n', 'utf-8');
          } catch (_) { /* fail-open */ }
          exitCode = 1;
        }
        // 'discarded' → worker exits cleanly with exitCode=0
      }

    // --- Deterministic orchestrator path (implement+apply stage) ---
    } else if (pipelineType === 'implement') {
      // TODO(phase2-wiring): gate2 poll + resume are not yet wired here.
      // The implement orchestrator uses the exit-and-resume defer-gate pattern:
      // it writes gate2 then returns — the worker exits, re-spawned on approval.
      // For the initial wiring, we call runImplementStageOrchestrator and then
      // return (no gate-poll await needed — the function already returns at gate2).
      const { runImplementStageOrchestrator } = await import('./lib/orchestrator/implement-stage.mjs');
      const { dispatchAgent } = await import('./lib/orchestrator/agent-dispatch.mjs');
      const { buildInjectedKnowledge } = await import('./lib/orchestrator/knowledge-inject.mjs');
      const { commitWorktree } = await import('./lib/orchestrator/commit-worktree.mjs');
      const { parseReviewerVerdict } = await import('./lib/orchestrator/reviewer-verdict.mjs');
      const { getGitExecutable } = await import('../packages/forge-core/src/runs/index.js');
      const buildMcpServer = (await import('./forge-worker-mcp.mjs')).default;

      const orchDeps = {
        dispatch: (agentType, promptLines) => dispatchAgent({
          agentType, promptLines, workDir, pluginRoot,
          buildMcpServer,
        }),
        spawnScript: async (scriptPath, args) => {
          const { spawn } = await import('node:child_process');
          return new Promise((res, rej) => {
            const child = spawn(process.execPath, [scriptPath, ...args], { cwd: workDir });
            let out = '';
            child.stdout.on('data', (d) => { out += d; });
            child.on('close', (code) => res({ stdout: out, exitCode: code }));
            child.on('error', rej);
          });
        },
        clearReviewerOutput: async () => {
          const dir = join(workDir, '.pipeline', 'context', 'reviewer-output');
          try {
            for (const f of readdirSync(dir)) {
              if (f.endsWith('.md')) unlinkSync(join(dir, f));
            }
          } catch (_) { /* dir absent — no-op */ }
        },
        readRunJson: (_path) => {
          const p = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
          return JSON.parse(readFileSync(p, 'utf-8'));
        },
        writeRunJson: async (_path, data) => {
          const p = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
          writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8');
        },
        writeGateFile: async (_path, content) => {
          writeFileSync(
            join(workDir, '.pipeline', 'gate-pending.json'),
            JSON.stringify(content, null, 2) + '\n', 'utf-8'
          );
        },
        readReviewerOutput: async (outputDir, reviewerName) => {
          try {
            const content = readFileSync(join(outputDir, reviewerName + '.md'), 'utf-8');
            // Robust: anchor on the "### Verdict" section, fail-safe BLOCK-wins. The old
            // first-line-only match silently dropped a BLOCK on a later line (soak #1).
            return { verdict: parseReviewerVerdict(content) };
          } catch (_) {
            // G4: a missing/unreadable verdict file means the reviewer crashed, truncated,
            // or timed out before writing. Treat as NO-VERDICT → REVISE (matches the skill
            // path's no-verdict→REVISE-unresolved handling). NEVER default to APPROVED —
            // that silently passes a dead reviewer straight through gate2.
            return { verdict: 'REVISE' };
          }
        },
        writeChangeSummary: async (_path, content) => {
          // 94302649 (apply-phase wiring): the off-worktree documenter (WS2) reads this.
          // Target MAIN's registry — the worktree is merged away post-gate2.
          const dir = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId);
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'change-summary.md'), content, 'utf-8');
        },
        // a8de840b #2: snapshot MAIN's changed paths under hooks/mcp/scripts so the
        // orchestrator can detect a dispatched agent writing OUTSIDE its worktree. Uses
        // the resolved git executable (the worker's PATH lacks git on Windows — #7), runs
        // against resolvedMainProjectRoot. Fail-soft to [] (never crash the run).
        snapshotMainStrays: async () => {
          try {
            const { execFileSync } = await import('node:child_process');
            const out = execFileSync(
              getGitExecutable(),
              ['-C', resolvedMainProjectRoot, 'status', '--porcelain', '--', 'hooks/', 'mcp/', 'scripts/'],
              { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 },
            );
            return String(out)
              .split('\n')
              .map((l) => l.replace(/\r$/, ''))
              .filter(Boolean)
              .map((l) => {
                const p = l.slice(3).replace(/^"|"$/g, '');
                const arrow = p.indexOf(' -> ');
                return (arrow >= 0 ? p.slice(arrow + 4) : p).trim();
              })
              .filter(Boolean);
          } catch (_) {
            return [];
          }
        },
        // docs/PLAN.md is UNTRACKED — lives only at the main project root, never in
        // the worktree checkout. Resolve via resolvedMainProjectRoot (not workDir).
        readPlanMd: () => {
          try {
            return readFileSync(join(resolvedMainProjectRoot, 'docs', 'PLAN.md'), 'utf-8');
          } catch (_) { return ''; }
        },
        commitWorktree,
        buildInjectedKnowledge,
        writeLog,
      };

      try {
        await runImplementStageOrchestrator(orchDeps, runId, workDir);
      } catch (err) {
        writeLog('[forge-worker] implement orchestrator error: ' + err.message);
        exitCode = 1;
      }
      // Implement orchestrator writes gate2 and returns — worker exits here.
      // On /forge:approve, the worker is re-spawned and the orchestrator resumes
      // from orchestratorState.phase='apply' (defer-gate pattern).
    } else {
    const stream = query({
      prompt: inputChannel,
      options: {
        // Worker is tool-routing only — dispatching subagents, gate polling,
        // checkpoint detection. Subagents carry their own model: in frontmatter.
        // Without an explicit model, the worker inherits the conductor session
        // model (often Opus 4.7) — expensive AND prone to over-thinking in
        // ambiguous states (cf. r-4addeb03 hang, 2026-05-16). Drop to Haiku
        // after TODO 1db279a1 (BLOCK handling) lands — at that point the worker
        // has near-zero judgment moments and Haiku is sufficient.
        model: 'claude-sonnet-4-6',
        cwd: workDir,
        persistSession: true,
        maxTurns: 200,
        permissionMode: 'bypassPermissions',
        // Disable automatic CLAUDE.md loading so no parent-directory CLAUDE.md
        // leaks conductor instructions into the worker session. settingSources: []
        // is the only way to suppress CLAUDE.md injection — systemPrompt alone
        // does not prevent it (they are orthogonal).
        settingSources: [],
        plugins: [{ type: 'local', path: pluginRoot }],
        mcpServers: {
          'forge-pipeline': buildInProcessMcpServer(workDir),
        },
      },
    });

    let gateHandled = false;
    let gateFileConsumed = false; // set after consumeGateApproval to block re-entry on stale run.json

    // Checkpoint re-dispatch tracking. Keyed by normalized agent type.
    // Cap: 2 re-dispatches per agent type per worker lifetime (= per run).
    const CHECKPOINT_RESUME_CAP = 2;
    const checkpointResumeCounts = new Map();

    // Progress logging — emit a structured line every 25 messages OR every 60s,
    // whichever first. Closes TODO `708c056f`. Useful for post-mortem when the
    // worker dies silently mid-processing (no exit reason, log just stops). The
    // contextEstimate (latest input + cache_creation + cache_read tokens divided
    // by 200k) gives a rough "how full is the current context window" signal so
    // /forge:resume can tell whether the worker hit the context wall vs crashed
    // for some other reason. Only fires while the for-await is iterating — true
    // idle (empty stream) is not covered.
    let progressMessagesSeen = 0;
    let progressAgentsCompleted = 0;
    let progressLastAgentType = null;
    let progressLastInputTokens = 0;
    let progressLastCacheCreate = 0;
    let progressLastCacheRead = 0;
    let progressLastOutputTokens = 0;
    let progressLastEmitAt = Date.now();
    const PROGRESS_MESSAGE_INTERVAL = 25;
    const PROGRESS_TIME_INTERVAL_MS = 60_000;

    // Context-budget monitoring: track the active subagent's agent_id and last bridge-write time.
    // Map<agentId, lastBridgeWriteAt> — prevents flooding the hook with repeated bridge writes.
    /** @type {Map<string, number>} */
    const budgetLastWriteAt = new Map();

    // Latest assistant text block — captured for proactive-interrupt checkpoint.md body.
    // Updated whenever an `assistant` message arrives with a `text` content block. Overwritten
    // on each new block so it always reflects the most-recent visible output before interrupt.
    let lastAssistantText = '';

    /**
     * Reads the sidecar file written by subagent-start.js inside the subagent process.
     * Returns the subagent's session_id, or null if the sidecar is absent/unreadable.
     * @param {string} agentId
     * @returns {Promise<string|null>}
     */
    async function readAgentSidecar(agentId) {
      const safeId = String(agentId).replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safeId) return null;
      const sidecarPath = join(tmpdir(), 'forge-agent-session-' + safeId + '.json');
      try {
        const raw = await fsPromises.readFile(sidecarPath, 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data.sessionId === 'string' && /^[a-zA-Z0-9_-]+$/.test(data.sessionId)) {
          return data.sessionId;
        }
        return null;
      } catch (_) {
        return null;
      }
    }

    /**
     * Writes the ctx bridge file for a subagent session so the PostToolUse hook fires
     * [CONTEXT-CHECKPOINT] on the subagent's next tool call.
     * Atomic write (.tmp + rename) to prevent partial reads.
     * @param {string} sessionId - the subagent's own session_id (from sidecar)
     * @param {number} remainingPct - percentage remaining (0–100)
     */
    async function writeBridge(sessionId, remainingPct) {
      const bridgePath = join(tmpdir(), 'claude-ctx-' + sessionId + '.json');
      const tmpPath = bridgePath + '.tmp.' + process.pid;
      try {
        await fsPromises.writeFile(
          tmpPath,
          JSON.stringify({ remaining: remainingPct, timestamp: Date.now() }),
          'utf8',
        );
        await fsPromises.rename(tmpPath, bridgePath);
        writeLog('[forge-worker] ctx bridge written for session ' + sessionId + ' remaining=' + Math.round(remainingPct));
      } catch (err) {
        writeLog('[forge-worker] ctx bridge write failed: ' + err.message);
      }
    }

    /**
     * Handles proactive context-budget monitoring for a usage update from the SDK stream.
     * Returns a directive object: { interrupt: false } when no action is needed, or
     * { interrupt: true, agentId, normType } when the 85% threshold is crossed and an
     * active agent is found. The 70% bridge-write path is preserved for consumedFraction
     * values in [0.70, 0.85).
     *
     * Callers must handle the interrupt directive in the for-await loop body — this function
     * intentionally does NOT call stream.interrupt() directly because it lacks access to
     * stream, inputChannel, and checkpointResumeCounts.
     *
     * @param {{ input_tokens?: number, cache_creation_input_tokens?: number, cache_read_input_tokens?: number }} usage
     * @returns {Promise<{ interrupt: false } | { interrupt: true, agentId: string, normType: string }>}
     */
    async function handleBudgetUsage(usage) {
      const { consumedFraction, interrupt: overThreshold } = evaluateBudget(usage, {
        window: BUDGET_CONTEXT_WINDOW,
        autocompactFactor: BUDGET_AUTOCOMPACT_FACTOR,
        interruptThreshold: BUDGET_INTERRUPT_THRESHOLD,
      });

      if (consumedFraction === 0) return { interrupt: false };
      if (consumedFraction < BUDGET_THRESHOLD_CONSUMED) return { interrupt: false };

      const remainingPct = Math.max(0, (1 - consumedFraction) * 100);

      // Read run-active.json to enumerate active agents.
      const activeData = readRunActiveData();
      if (!activeData || !Array.isArray(activeData.agents)) return { interrupt: false };

      const now = Date.now();

      if (overThreshold) {
        // Find the FIRST non-completed agent to interrupt.
        for (const agent of activeData.agents) {
          if (agent.outcome) continue;
          const agentId = agent.agent_id;
          if (!agentId) continue;
          const rawType = agent.agent_type || '';
          const normType = rawType.startsWith('forge:') ? rawType.slice('forge:'.length) : rawType;
          return { interrupt: true, agentId, normType };
        }
        // No active agent found — nothing to interrupt.
        return { interrupt: false };
      }

      // consumedFraction in [BUDGET_THRESHOLD_CONSUMED, BUDGET_INTERRUPT_THRESHOLD) — bridge write path.
      for (const agent of activeData.agents) {
        // Skip agents that have already completed.
        if (agent.outcome) continue;
        const agentId = agent.agent_id;
        if (!agentId) continue;

        // Debounce: skip if we wrote a bridge for this agent recently.
        const lastWrite = budgetLastWriteAt.get(agentId) || 0;
        if (now - lastWrite < BUDGET_DEBOUNCE_MS) continue;

        // Resolve agent_id → session_id via sidecar.
        const sessionId = await readAgentSidecar(agentId);
        if (!sessionId) {
          process.stderr.write('[forge-worker] no sidecar for agent ' + agentId + ' — skipping bridge write\n');
          continue;
        }

        budgetLastWriteAt.set(agentId, now);
        await writeBridge(sessionId, remainingPct);
      }

      return { interrupt: false };
    }

    for await (const msg of stream) {
      writeLog(JSON.stringify(msg));

      // Progress accounting (TODO 708c056f).
      progressMessagesSeen += 1;
      if (msg && msg.type === 'system' && msg.subtype === 'task_notification' && msg.status === 'completed') {
        progressAgentsCompleted += 1;
      }

      // Checkpoint resume handler.
      // Fires when a subagent completes — reads run-active.json to detect
      // whether the most-recently-completed agent has outcome === 'checkpoint'.
      if (msg && msg.type === 'system' && msg.subtype === 'task_notification' && msg.status === 'completed') {
        const activeData = readRunActiveData();
        if (activeData && Array.isArray(activeData.agents) && activeData.agents.length > 0) {
          // Find the most recently completed agent (highest completedAt)
          let latest = null;
          for (const a of activeData.agents) {
            if (!latest || (typeof a.completedAt === 'number' && a.completedAt > (latest.completedAt || 0))) {
              latest = a;
            }
          }
          if (latest && latest.outcome === 'checkpoint') {
            const rawType = latest.agent_type || '';
            const normType = rawType.startsWith('forge:') ? rawType.slice('forge:'.length) : rawType;
            const priorResumes = checkpointResumeCounts.get(normType) || 0;

            if (priorResumes >= CHECKPOINT_RESUME_CAP) {
              // Cap hit — surface as hard failure so the conductor can investigate
              writeLog('[forge-worker] CHECKPOINT CAP HIT: ' + normType + ' has been resumed ' + priorResumes + ' times — context too large for a single pass. Stopping worker.');
              process.stderr.write('[forge-worker] CHECKPOINT CAP HIT: ' + normType + ' exhausted ' + CHECKPOINT_RESUME_CAP + ' checkpoint resumes. Work is too large for context — manual intervention required.\n');

              // Stamp the latest agent entry as context-exhausted in run-active.json.
              // Terminal override — subagent-stop.js cannot stamp this outcome because
              // it has no access to the resume count. Both writes are fail-open.
              try {
                if (latest) {
                  latest.outcome = 'context-exhausted';
                  const runActivePath = join(workDir, '.pipeline', 'runs', runId, 'run-active.json');
                  writeFileSync(runActivePath, JSON.stringify(activeData, null, 2) + '\n', 'utf-8');
                }
              } catch (_) {
                // fail-open — run-active.json update is best-effort
              }

              // Mark run.json as failed with a descriptive reason
              try {
                const runPath = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
                const raw = readFileSync(runPath, 'utf-8');
                const runObj = JSON.parse(raw);
                runObj.status = 'failed';
                runObj.failureReason = 'context-exhausted: ' + normType + ' exceeded checkpoint resume cap (' + CHECKPOINT_RESUME_CAP + '). Manual intervention required.';
                writeFileSync(runPath, JSON.stringify(runObj, null, 2) + '\n', 'utf-8');
              } catch (_) {
                // fail-open — run.json update is best-effort
              }

              break;
            }

            checkpointResumeCounts.set(normType, priorResumes + 1);
            writeLog('[forge-worker] checkpoint detected for ' + normType + ' (resume ' + (priorResumes + 1) + '/' + CHECKPOINT_RESUME_CAP + ') — re-dispatching');

            const checkpointPath = join(workDir, 'docs', 'context', 'checkpoint.md');
            const resumeMsg = '[resume-from-checkpoint]\n' +
              'The previous ' + normType + ' agent hit its context limit mid-task. ' +
              'Read `docs/context/checkpoint.md` to see what was completed and what remains. ' +
              'Continue from where the prior pass stopped — do not repeat completed work.';

            inputChannel.push({
              type: 'user',
              message: { role: 'user', content: resumeMsg },
              parent_tool_use_id: null,
            });
            writeLog('[forge-worker] injected checkpoint resume message for ' + normType);
          } else if (latest && latest.outcome !== 'checkpoint') {
            // Agent completed normally — clean up checkpoint.md if it exists (best-effort)
            try {
              const checkpointPath = join(workDir, 'docs', 'context', 'checkpoint.md');
              if (existsSync(checkpointPath)) {
                unlinkSync(checkpointPath);
                writeLog('[forge-worker] deleted checkpoint.md after clean completion of ' + (latest.agent_type || 'unknown'));
              }
            } catch (_) {
              // Non-fatal — checkpoint cleanup is best-effort
            }
          }
        }
      }

      if (msg && msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block && block.type === 'tool_use' && block.name === 'Agent' && block.input && block.input.subagent_type) {
            progressLastAgentType = block.input.subagent_type;
          }
          // Capture latest assistant text for proactive-interrupt checkpoint body.
          if (block && block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
            lastAssistantText = block.text;
          }
        }
      }
      if (msg && msg.type === 'assistant' && msg.message && msg.message.usage) {
        const u = msg.message.usage;
        if (typeof u.input_tokens === 'number') progressLastInputTokens = u.input_tokens;
        if (typeof u.cache_creation_input_tokens === 'number') progressLastCacheCreate = u.cache_creation_input_tokens;
        if (typeof u.cache_read_input_tokens === 'number') progressLastCacheRead = u.cache_read_input_tokens;
        if (typeof u.output_tokens === 'number') progressLastOutputTokens = u.output_tokens;

        // Proactive context-budget monitoring.
        // handleBudgetUsage now returns a directive — bridge-write side-effect happens
        // inside it for the [0.70, 0.85) band; for >=0.85 it returns interrupt:true and
        // this body invokes proactiveInterruptStep with the references it needs
        // (stream, inputChannel, checkpointResumeCounts) which handleBudgetUsage lacks.
        // The reactive checkpoint handler (lines ~518–594) is unchanged — see
        // docs/PLAN.md "Worker-side proactive context-budget interrupt" task 5(f).
        let budgetDirective = { interrupt: false };
        try {
          budgetDirective = await handleBudgetUsage(u);
        } catch (err) {
          writeLog('[forge-worker] handleBudgetUsage error: ' + err.message);
          budgetDirective = { interrupt: false };
        }
        if (budgetDirective && budgetDirective.interrupt) {
          try {
            const result = await proactiveInterruptStep({
              directive: budgetDirective,
              runId,
              workDir,
              stream,
              channel: inputChannel,
              counters: checkpointResumeCounts,
              cap: CHECKPOINT_RESUME_CAP,
              lastAssistantText,
              projectRoot: resolvedMainProjectRoot,
            });
            if (result && result.capped) {
              writeLog('[forge-worker] PROACTIVE-INTERRUPT CAP HIT for ' + budgetDirective.normType + ' — stopping worker');
              process.stderr.write('[forge-worker] PROACTIVE-INTERRUPT CAP HIT: ' + budgetDirective.normType + ' exhausted ' + CHECKPOINT_RESUME_CAP + ' checkpoint resumes — manual intervention required.\n');
              break;
            }
            writeLog('[forge-worker] proactive interrupt fired for ' + budgetDirective.normType + ' (resume ' + (checkpointResumeCounts.get(budgetDirective.normType) || 0) + '/' + CHECKPOINT_RESUME_CAP + ')');
          } catch (err) {
            writeLog('[forge-worker] proactiveInterruptStep error: ' + err.message);
          }
        }
      }
      const sinceLastEmit = Date.now() - progressLastEmitAt;
      if ((progressMessagesSeen % PROGRESS_MESSAGE_INTERVAL === 0) || sinceLastEmit >= PROGRESS_TIME_INTERVAL_MS) {
        const contextTokens = progressLastInputTokens + progressLastCacheCreate + progressLastCacheRead;
        const contextEstimate = Math.round((contextTokens / 200_000) * 1000) / 1000;
        const progressLine = JSON.stringify({
          type: 'forge-worker-progress',
          runId,
          messagesSeen: progressMessagesSeen,
          agentsCompleted: progressAgentsCompleted,
          lastAgentType: progressLastAgentType,
          contextTokens,
          contextEstimate,
          lastOutputTokens: progressLastOutputTokens,
          timestamp: new Date().toISOString(),
        });
        writeLog(progressLine);
        progressLastEmitAt = Date.now();
      }

      if (workerTimedOut) {
        writeLog('[forge-worker] timeout reached mid-stream — breaking');
        break;
      }

      if (poisonPillDetected) {
        writeLog('[forge-worker] poison pill detected -- stopping');
        const runPath = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
        try {
          const raw = readFileSync(runPath, 'utf-8');
          const runObj = JSON.parse(raw);
          runObj.status = 'discarded';
          runObj.failureReason = 'killed by conductor';
          writeFileSync(runPath, JSON.stringify(runObj, null, 2) + '\n', 'utf-8');
        } catch (_) {
          // fail-open: run.json update is best-effort
        }
        try { unlinkSync(pillPath); } catch (_) {}
        break;
      }

      // Terminal-status poll: debounced to at most once per 500 ms so the check
      // does not multiply with high-frequency stream messages during agent dispatch.
      // Absent/unreadable run.json is treated as non-terminal (fail-open per GENERAL.md).
      if (Date.now() - lastStatusReadAt >= 500) {
        lastStatusReadAt = Date.now();
        const terminalData = readRunData();
        const terminalStatus = terminalData && terminalData.status;
        if (terminalStatus === 'completed' || terminalStatus === 'failed' || terminalStatus === 'discarded') {
          writeLog('[forge-worker] run is terminal (status=' + terminalStatus + ') — exiting');
          break;
        }
      }

      if (gateHandled || gateFileConsumed) continue;

      const runData = readRunData();

      // Check for loop-guard sidecar — fires when hook writes sidecar on cap-fire
      const loopGuardSidecarPath = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'loop-guard-blocked.json');
      let loopGuardDetected = false;
      if (runData && runData.status === 'running' && existsSync(loopGuardSidecarPath)) {
        let sidecarValid = false;
        try {
          const raw = readFileSync(loopGuardSidecarPath, 'utf-8');
          const sidecarData = JSON.parse(raw);
          sidecarValid = sidecarData &&
            typeof sidecarData.agentType === 'string' &&
            typeof sidecarData.blockedAt === 'string' &&
            sidecarData.runId === runId;
        } catch (_) { /* malformed */ }
        if (sidecarValid) {
          try {
            const runPath = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
            const raw = readFileSync(runPath, 'utf-8');
            const runObj = JSON.parse(raw);
            if (runObj.status === 'running') {
              runObj.status = 'loop-guard-pending';
              runObj.updatedAt = new Date().toISOString();
              writeFileSync(runPath, JSON.stringify(runObj, null, 2) + '\n', 'utf-8');
            }
          } catch (_) {}
          loopGuardDetected = true;
        } else {
          writeLog('[forge-worker] loop-guard sidecar malformed — ignoring');
        }
      }

      if (runData && runData.status === 'gate-pending' &&
          runData.gateState && runData.gateState.status === 'pending') {
        gateHandled = true;
        gateFileConsumed = false; // entering a new gate — reset consumed flag
        // Use GATE_POLL_TIMEOUT_MS (6 h default) so human review time does not
        // count against the active-worker budget (WORKER_TIMEOUT_MS = 60 min).
        resetWorkerTimer(GATE_POLL_TIMEOUT_MS);
        const gateName = (runData.gateState && runData.gateState.gate) || 'unknown';
        writeLog('[forge-worker] gate-pending detected for run ' + runId + ' gate=' + gateName + ' gate-poll-timeout=' + GATE_POLL_TIMEOUT_MS + ' ms');

        // commit gates: worker's job is done — conductor owns commit+merge.
        if (gateName === 'commit') {
          writeLog('[forge-worker] commit gate detected — exiting, conductor handles commit+merge');
          break;
        }

        // gate1 and gate2: wait for conductor approval, then resume worker.
        // runData.worktreePath is reliably populated by forge_create_run (via
        // createWorktree) before the worker spawns — no singleton fallback needed.
        let gatePath;
        const wtPath = runData.worktreePath;
        if (wtPath) {
          gatePath = join(wtPath, '.pipeline', 'gate-pending.json');
        } else {
          gatePath = join(workDir, '.pipeline', 'gate-pending.json');
        }

        writeLog('[forge-worker] polling gate file: ' + gatePath + ' (expecting gate=' + gateName + ')');
        const decision = await waitForGateDecision(gatePath, gateName);
        writeLog('[forge-worker] gate decision: ' + decision);

        if (decision === 'approved') {
          gateHandled = false; // allow detecting the next gate after resuming
          gateFileConsumed = true; // block re-entry on stale run.json until conductor writes fresh status
          const resumeMsg = gateName === 'gate2'
            ? 'Gate 2 approved. Continue with /forge:apply steps in this session: run documenter, lifecycle cleanup, then write a commit gate.'
            : 'approved';
          inputChannel.push({
            type: 'user',
            message: { role: 'user', content: resumeMsg },
            parent_tool_use_id: null,
          });
          consumeGateApproval(gatePath, gateName);
          resetWorkerTimer();
          writeLog('[forge-worker] injected ' + gateName + ' approval — resuming pipeline');
        } else {
          writeLog('[forge-worker] gate ' + decision + ' — stopping worker');
          if (decision === 'timeout') {
            // Closes TODO aea02487. Without this stamp, run.status stays 'gate-pending'
            // with an approved gateState — /forge:apply refuses to spawn recovery
            // because the apply guard treats the run as "worker should be resuming".
            // Mirrors the poison-pill pattern at lines 683-692.
            const runPath = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
            try {
              const raw = readFileSync(runPath, 'utf-8');
              const runObj = JSON.parse(raw);
              runObj.status = 'failed';
              runObj.failureReason = buildGatePollFailureReason(gateName, GATE_POLL_TIMEOUT_MS);
              writeFileSync(runPath, JSON.stringify(runObj, null, 2) + '\n', 'utf-8');
            } catch (_) {
              // fail-open: run.json update is best-effort
            }
          }
          break;
        }
      } else if (runData && runData.status === 'waiting-for-escalation') {
        // Use ESCALATION_POLL_TIMEOUT_MS so human response time does not count
        // against the active-worker budget (WORKER_TIMEOUT_MS = 60 min).
        resetWorkerTimer(ESCALATION_POLL_TIMEOUT_MS);
        const escDir = join(resolvedMainProjectRoot, '.pipeline', 'escalations');
        writeLog('[forge-worker] waiting-for-escalation detected for run ' + runId + ' escalation-poll-timeout=' + ESCALATION_POLL_TIMEOUT_MS + ' ms');

        const responseResult = await waitForEscalationResponse(escDir);
        writeLog('[forge-worker] escalation response result: ' + (typeof responseResult === 'object' ? responseResult.escalationId : responseResult));

        if (typeof responseResult === 'object' && responseResult.response) {
          // Flip run status back to running
          try {
            const runPath = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
            const raw = readFileSync(runPath, 'utf-8');
            const runObj = JSON.parse(raw);
            if (runObj.status === 'waiting-for-escalation') {
              runObj.status = 'running';
              runObj.updatedAt = new Date().toISOString();
              writeFileSync(runPath, JSON.stringify(runObj, null, 2) + '\n', 'utf-8');
            }
          } catch (_) {
            // fail-open: run.json update is best-effort
          }
          // Inject response as user message
          inputChannel.push({
            type: 'user',
            message: { role: 'user', content: 'Escalation response received (escalationId: ' + responseResult.escalationId + '): ' + responseResult.response },
            parent_tool_use_id: null,
          });
          resetWorkerTimer(); // reset to 60-min active budget
          writeLog('[forge-worker] injected escalation response for escalationId=' + responseResult.escalationId + ' — resuming');
        } else {
          writeLog('[forge-worker] escalation ' + responseResult + ' — stopping worker');
          if (responseResult === 'timeout') {
            try {
              const runPath = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
              const raw = readFileSync(runPath, 'utf-8');
              const runObj = JSON.parse(raw);
              runObj.status = 'failed';
              runObj.failureReason = 'worker timeout: escalation response not received within ' + ESCALATION_POLL_TIMEOUT_MS + ' ms at ' + new Date().toISOString();
              runObj.updatedAt = new Date().toISOString();
              writeFileSync(runPath, JSON.stringify(runObj, null, 2) + '\n', 'utf-8');
            } catch (_) {
              // fail-open: run.json update is best-effort
            }
          }
          break;
        }
      } else if (loopGuardDetected || (runData && runData.status === 'loop-guard-pending')) {
        resetWorkerTimer(GATE_POLL_TIMEOUT_MS);
        writeLog('[forge-worker] loop-guard-pending detected for run ' + runId + ' gate-poll-timeout=' + GATE_POLL_TIMEOUT_MS + ' ms');

        const clearResult = await waitForLoopGuardClear(loopGuardSidecarPath);
        writeLog('[forge-worker] loop-guard clear result: ' + clearResult);

        if (clearResult === 'cleared') {
          try {
            const runPath = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
            const raw = readFileSync(runPath, 'utf-8');
            const runObj = JSON.parse(raw);
            if (runObj.status === 'loop-guard-pending') {
              runObj.status = 'running';
              runObj.updatedAt = new Date().toISOString();
              writeFileSync(runPath, JSON.stringify(runObj, null, 2) + '\n', 'utf-8');
            }
          } catch (_) {}
          inputChannel.push({
            type: 'user',
            message: { role: 'user', content: '[forge-worker] loop-guard cleared — resuming' },
            parent_tool_use_id: null,
          });
          resetWorkerTimer();
          writeLog('[forge-worker] loop-guard cleared — resuming');
        } else {
          writeLog('[forge-worker] loop-guard ' + clearResult + ' — stopping worker');
          if (clearResult === 'timeout') {
            try {
              const runPath = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId, 'run.json');
              const raw = readFileSync(runPath, 'utf-8');
              const runObj = JSON.parse(raw);
              runObj.status = 'failed';
              runObj.failureReason = buildGatePollFailureReason('loop-guard', GATE_POLL_TIMEOUT_MS);
              runObj.updatedAt = new Date().toISOString();
              writeFileSync(runPath, JSON.stringify(runObj, null, 2) + '\n', 'utf-8');
            } catch (_) {}
          }
          break;
        }
      }
    }
    } // close orchestrator else — LLM prose path

    clearTimeout(workerTimer);
    writeLog('[forge-worker] completed run ' + runId);
  } catch (err) {
    clearTimeout(workerTimer);
    const errMsg = err instanceof Error ? err.message : String(err);
    writeLog('[forge-worker] unhandled error: ' + errMsg);
    process.stderr.write('[forge-worker] unhandled error: ' + errMsg + '\n');
    exitCode = 1;
  } finally {
    // Closes 7fe538ee sub-bug 2: stamp any orphan agent entries (startedAt
    // set but completedAt null) before the worker exits. The subagent-stop
    // hook should be authoritative; this is a fallback for the cases where
    // the SDK lost the stop signal or the hook crashed silently. Fail-open.
    try {
      const summary = stampOrphanAgents(workDir, runId);
      if (summary.stamped > 0) {
        writeLog('[forge-worker] orphan-stop: stamped ' + summary.stamped + '/' + summary.total + ' agent(s) before exit');
      }
    } catch (_) {
      // Cleanup must never block exit — swallow any unexpected error.
    }
    // Task 17a — Watchdog stamp: if the worker exits without a failureReason in run.json,
    // write a sidecar so forge_get_run can surface the silent-exit (catches r-468be1b4).
    // Uses the sidecar pattern (writes watchdog-stamp.json, never modifies run.json directly)
    // per concurrent-write discipline. writeLog uses writeLog() not console.error().
    try {
      const runDir = join(resolvedMainProjectRoot, '.pipeline', 'runs', runId);
      const runJsonPath = join(runDir, 'run.json');
      const watchdogStampPath = join(runDir, 'watchdog-stamp.json');
      if (existsSync(runJsonPath)) {
        const raw = readFileSync(runJsonPath, 'utf-8');
        const runData = JSON.parse(raw);
        if (!runData.failureReason) {
          writeFileSync(
            watchdogStampPath,
            JSON.stringify({
              failureReason: 'worker-exited-without-reason',
              status: 'failed',
              stampedAt: new Date().toISOString(),
            }, null, 2) + '\n',
            'utf-8',
          );
          writeLog('[forge-worker] watchdog-stamp: silent exit detected, wrote watchdog-stamp.json for ' + runId);
        }
      }
    } catch (stampErr) {
      // Must not block exit
      writeLog('[forge-worker] watchdog-stamp: failed: ' + (stampErr && stampErr.message));
    }
    inputChannel.close();
    try { closeSync(logFd); } catch (_) {}
    try { unwatchFile(pillPath); } catch (_) {}
  }
  process.exit(exitCode);
}

main();
