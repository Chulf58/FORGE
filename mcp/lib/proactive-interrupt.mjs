/**
 * Proactive context-budget interrupt helpers.
 *
 * `evaluateBudget` — pure, no I/O. Returns whether the interrupt threshold is crossed.
 * `proactiveInterruptStep` — orchestrates I/O: writes checkpoint.md, stamps
 *   run-active.json, calls stream.interrupt(), and pushes a resume message.
 */

import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize an agentId for use in a filename.
 * @param {string} agentId
 * @returns {string}
 */
function safeId(agentId) {
  return String(agentId).replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Writes `content` to `targetPath` atomically via a .tmp sibling + rename.
 * Ensures the parent directory exists before writing.
 * @param {string} targetPath
 * @param {string} content
 */
function writeAtomic(targetPath, content) {
  const tmpPath = targetPath + '.tmp.' + process.pid;
  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(tmpPath, content, 'utf8');
    renameSync(tmpPath, targetPath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch (_) {}
    throw err;
  }
}

/**
 * Stamps `outcome` on the agent entry identified by `agentId` in run-active.json.
 * Atomic write (.tmp + rename). Fail-open — never throws.
 * @param {string} runActivePath
 * @param {string} agentId
 * @param {string} outcome
 */
function stampOutcomeAtomic(runActivePath, agentId, outcome) {
  try {
    const raw = readFileSync(runActivePath, 'utf8');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.agents)) {
      const entry = data.agents.find((a) => a.agent_id === agentId);
      if (entry) {
        entry.outcome = outcome;
      }
    }
    writeAtomic(runActivePath, JSON.stringify(data, null, 2) + '\n');
  } catch (_) {
    // fail-open — best effort; run-active.json stamp is belt-and-suspenders
  }
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

/**
 * Pure helper — no I/O.
 * Evaluates whether the consumed token fraction crosses the interrupt threshold.
 *
 * @param {{ input_tokens?: unknown, cache_creation_input_tokens?: unknown, cache_read_input_tokens?: unknown } | null | undefined} usage
 * @param {{ window: number, autocompactFactor: number, interruptThreshold: number }} opts
 * @returns {{ interrupt: boolean, consumedFraction: number }}
 */
export function evaluateBudget(usage, { window, autocompactFactor, interruptThreshold }) {
  const input  = Number(usage?.input_tokens                ?? 0);
  const create = Number(usage?.cache_creation_input_tokens ?? 0);
  const cacheR = Number(usage?.cache_read_input_tokens     ?? 0);
  const total = input + create + cacheR;
  if (total === 0) return { interrupt: false, consumedFraction: 0 };
  const usable = window * autocompactFactor;
  const consumedFraction = total / usable;
  return { interrupt: consumedFraction >= interruptThreshold, consumedFraction };
}

/**
 * Orchestrator — does I/O. Called from the for-await loop body.
 *
 * Sequence when not capped:
 *   1. Write checkpoint.md BEFORE interrupt().
 *   2. Stamp run-active.json outcome:'checkpoint' atomically.
 *   3. Write proactive-interrupt sidecar (belt-and-suspenders).
 *   4. Await stream.interrupt().
 *   5. Read-then-delete sidecar atomically.
 *   6. Increment cap counter.
 *   7. Push resume message into channel.
 *
 * Returns { capped: true } when the cap is already exhausted (caller should break).
 *
 * @param {{
 *   directive: { interrupt: true, agentId: string, normType: string },
 *   runId: string,
 *   workDir: string,
 *   stream: { interrupt: () => Promise<void> },
 *   channel: { push: (v: unknown) => void },
 *   counters: Map<string, number>,
 *   cap: number,
 *   lastAssistantText?: string,
 *   projectRoot?: string,
 * }} params
 * @returns {Promise<{ capped: boolean }>}
 */
export async function proactiveInterruptStep({
  directive,
  runId,
  workDir,
  stream,
  channel,
  counters,
  cap,
  lastAssistantText,
  projectRoot,
}) {
  const priorResumes = counters.get(directive.normType) || 0;
  const wouldExceedCap = priorResumes >= cap;

  const runActivePath = join(workDir, '.pipeline', 'runs', runId, 'run-active.json');

  if (wouldExceedCap) {
    // Stamp context-exhausted on the matching agent entry.
    stampOutcomeAtomic(runActivePath, directive.agentId, 'context-exhausted');

    // Mark run.json failed — caller passes projectRoot; skip if absent.
    if (projectRoot) {
      try {
        const runPath = join(projectRoot, '.pipeline', 'runs', runId, 'run.json');
        const raw = readFileSync(runPath, 'utf-8');
        const runObj = JSON.parse(raw);
        runObj.status = 'failed';
        runObj.failureReason =
          'context-exhausted: ' + directive.normType +
          ' exceeded checkpoint resume cap (' + cap + '). Manual intervention required.';
        writeFileSync(runPath, JSON.stringify(runObj, null, 2) + '\n', 'utf-8');
      } catch (_) { /* fail-open */ }
    }
    return { capped: true };
  }

  // Step 1: Write synthetic checkpoint.md BEFORE calling stream.interrupt().
  const checkpointPath = join(workDir, 'docs', 'context', 'checkpoint.md');
  const checkpointBody =
    (lastAssistantText || '') +
    '\n\n---\nauto-interrupted at proactive budget threshold (' + directive.normType + ')\n';
  writeAtomic(checkpointPath, checkpointBody);

  // Step 2: Stamp outcome:'checkpoint' on the matching agent (atomic .tmp + rename).
  stampOutcomeAtomic(runActivePath, directive.agentId, 'checkpoint');

  // Step 3: Write the proactive-interrupt sidecar (belt-and-suspenders).
  const sidecarPath = join(tmpdir(), 'forge-proactive-interrupt-' + safeId(directive.agentId) + '.json');
  try {
    writeFileSync(
      sidecarPath,
      JSON.stringify({
        outcome: 'checkpoint',
        normType: directive.normType,
        agentId: directive.agentId,
        ts: Date.now(),
      }),
      'utf8',
    );
  } catch (_) { /* fail-open */ }

  // Step 4: Call stream.interrupt() — must be awaited per SDK contract.
  try { await stream.interrupt(); } catch (_) { /* fail-open — interrupt errors are non-fatal */ }

  // Step 5: Atomically read-then-delete the sidecar.
  try {
    readFileSync(sidecarPath, 'utf8'); // best-effort confirm presence
    unlinkSync(sidecarPath);
  } catch (_) { /* fail-open — sidecar may have already been consumed or never written */ }

  // Step 6: Increment the cap counter.
  counters.set(directive.normType, priorResumes + 1);

  // Step 7: Push the resume message — exact shape match forge-worker.mjs lines 549–553.
  const resumeMsg =
    '[resume-from-checkpoint]\n' +
    'The previous ' + directive.normType + ' agent hit its context limit mid-task. ' +
    'Read `docs/context/checkpoint.md` to see what was completed and what remains. ' +
    'Continue from where the prior pass stopped — do not repeat completed work.';
  channel.push({
    type: 'user',
    message: { role: 'user', content: resumeMsg },
    parent_tool_use_id: null,
  });

  return { capped: false };
}
