import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, writeFileSync, existsSync, unlinkSync, openSync, writeSync, closeSync, mkdirSync, readdirSync, watchFile, unwatchFile } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerLogPath, killPillPath, resetPillPath } from './lib/worker-paths.js';

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

  // 60-minute safety valve — prevents the worker from running indefinitely if
  // gate polling hangs or the pipeline never reaches a terminal state. Was 30
  // minutes; raised after phased implement runs hit the cap mid-Phase-3 (4
  // phases × ~10 min each does not fit in 30 min). Per-phase reset is a
  // follow-up — see TODO for skills/implement/SKILL.md to call resetWorkerTimer
  // after each phase commit.
  const WORKER_TIMEOUT_MS = 60 * 60 * 1000;
  let workerTimedOut = false;
  let workerTimer = setTimeout(() => {
    workerTimedOut = true;
    writeLog('[forge-worker] 60-minute timeout reached — aborting');
  }, WORKER_TIMEOUT_MS);
  workerTimer.unref();

  /**
   * Clears the existing safety-valve timer and starts a fresh 60-minute window.
   * Called when entering gate-pending (so review time doesn't count against the
   * worker budget) and after gate approval (so the resumed pipeline gets a full window).
   */
  function resetWorkerTimer() {
    clearTimeout(workerTimer);
    workerTimedOut = false;
    workerTimer = setTimeout(() => {
      workerTimedOut = true;
      writeLog('[forge-worker] 60-minute timeout reached — aborting');
    }, WORKER_TIMEOUT_MS);
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
   * Polls a gate file until its status is 'approved' or 'discarded',
   * or until the worker timeout fires.
   *
   * Uses watchFile (stat-polling, cross-platform) for change detection,
   * with a 3 s setInterval fallback to guard against missed events.
   * Resolves with 'approved', 'discarded', or 'timeout'.
   */
  function waitForGateDecision(gatePath) {
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

  try {
    const stream = query({
      prompt: inputChannel,
      options: {
        cwd: workDir,
        persistSession: true,
        maxTurns: 200,
        permissionMode: 'bypassPermissions',
        plugins: [{ type: 'local', path: pluginRoot }],
        mcpServers: {
          'forge-pipeline': {
            command: 'node',
            args: [join(pluginRoot, 'mcp', 'server.js')],
            env: { CLAUDE_PROJECT_DIR: workDir, FORGE_WORKER_SESSION: '1' },
          },
        },
      },
    });

    let gateHandled = false;

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

    for await (const msg of stream) {
      writeLog(JSON.stringify(msg));

      // Progress accounting (TODO 708c056f).
      progressMessagesSeen += 1;
      if (msg && msg.type === 'system' && msg.subtype === 'task_notification' && msg.status === 'completed') {
        progressAgentsCompleted += 1;
      }
      if (msg && msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block && block.type === 'tool_use' && block.name === 'Agent' && block.input && block.input.subagent_type) {
            progressLastAgentType = block.input.subagent_type;
          }
        }
      }
      if (msg && msg.type === 'assistant' && msg.message && msg.message.usage) {
        const u = msg.message.usage;
        if (typeof u.input_tokens === 'number') progressLastInputTokens = u.input_tokens;
        if (typeof u.cache_creation_input_tokens === 'number') progressLastCacheCreate = u.cache_creation_input_tokens;
        if (typeof u.cache_read_input_tokens === 'number') progressLastCacheRead = u.cache_read_input_tokens;
        if (typeof u.output_tokens === 'number') progressLastOutputTokens = u.output_tokens;
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

      if (gateHandled) continue;

      const runData = readRunData();
      if (runData && runData.status === 'gate-pending' &&
          runData.gateState && runData.gateState.status === 'pending') {
        gateHandled = true;
        resetWorkerTimer();
        const gateName = (runData.gateState && runData.gateState.gate) || 'unknown';
        writeLog('[forge-worker] gate-pending detected for run ' + runId + ' gate=' + gateName);

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

        writeLog('[forge-worker] polling gate file: ' + gatePath);
        const decision = await waitForGateDecision(gatePath);
        writeLog('[forge-worker] gate decision: ' + decision);

        if (decision === 'approved') {
          gateHandled = false; // allow detecting the next gate after resuming
          const resumeMsg = gateName === 'gate2'
            ? 'Gate 2 approved. Continue with /forge:apply steps in this session: run documenter, lifecycle cleanup, then write a commit gate.'
            : 'approved';
          inputChannel.push({
            type: 'user',
            message: { role: 'user', content: resumeMsg },
            parent_tool_use_id: null,
          });
          resetWorkerTimer();
          writeLog('[forge-worker] injected ' + gateName + ' approval — resuming pipeline');
        } else {
          writeLog('[forge-worker] gate ' + decision + ' — stopping worker');
          break;
        }
      }
    }

    clearTimeout(workerTimer);
    writeLog('[forge-worker] completed run ' + runId);
  } catch (err) {
    clearTimeout(workerTimer);
    const errMsg = err instanceof Error ? err.message : String(err);
    writeLog('[forge-worker] unhandled error: ' + errMsg);
    process.stderr.write('[forge-worker] unhandled error: ' + errMsg + '\n');
    exitCode = 1;
  } finally {
    inputChannel.close();
    try { closeSync(logFd); } catch (_) {}
    try { unwatchFile(pillPath); } catch (_) {}
  }
  process.exit(exitCode);
}

main();
