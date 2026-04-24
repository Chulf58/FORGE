#!/usr/bin/env node
// Deterministic completeness check — fast path for the completeness-checker agent.
//
// When docs/context/coder-status.json has tasksCovered and tasksDeferred arrays,
// evaluates plan coverage as a set-difference without LLM tokens.
//
// Usage:
//   node scripts/completeness-check.mjs [--root <path>]
//
// Exit codes:
//   0 — valid completeness verdict produced (JSON result on stdout)
//   1 — fallback needed (missing files, malformed sidecar, semantic matching required)

import fs from 'node:fs';
import path from 'node:path';
import { extractActiveFeatureSection } from './lib/plan-utils.mjs';

function log(msg) {
  process.stderr.write(`[completeness-check] ${msg}\n`);
}

// --- Helpers ----------------------------------------------------------------

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function dirExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

// --- Plan parsing -----------------------------------------------------------

// extractActiveFeatureSection imported from ./lib/plan-utils.mjs

function extractActiveTaskIds(sectionLines) {
  const tasks = [];
  const uncheckedLines = [];
  const TASK_NUM_RE = /^- \[ \]\s+(\d+)\./;

  for (const line of sectionLines) {
    if (/^- \[ \]/.test(line)) {
      uncheckedLines.push(line);
      const match = TASK_NUM_RE.exec(line);
      if (match) {
        tasks.push({
          id: parseInt(match[1], 10),
          title: line.replace(TASK_NUM_RE, '').trim(),
        });
      }
    }
  }

  if (uncheckedLines.length === 0) {
    return { tasks: [], error: 'no unchecked task lines in active feature section — fallback to agent' };
  }

  if (tasks.length < uncheckedLines.length) {
    const parsedIds = new Set(tasks.map(t => t.id));
    const firstBad = uncheckedLines.find(l => !TASK_NUM_RE.test(l));
    const preview = firstBad ? firstBad.slice(0, 80) : '(unknown)';
    return { tasks: [], error: `${uncheckedLines.length - tasks.length} unchecked task line(s) have no parseable task number — first: "${preview}" — fallback to agent` };
  }

  const ids = tasks.map(t => t.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size < ids.length) {
    return { tasks: [], error: 'duplicate task IDs in active feature section — fallback to agent' };
  }

  return { tasks, error: null };
}

// --- Sidecar validation -----------------------------------------------------

function validateSidecar(sidecar) {
  if (!sidecar || typeof sidecar !== 'object') return false;
  if (!Array.isArray(sidecar.tasksCovered)) return false;
  if (!Array.isArray(sidecar.tasksDeferred)) return false;
  if (!sidecar.tasksCovered.every(n => Number.isInteger(n))) return false;
  if (!sidecar.tasksDeferred.every(n => Number.isInteger(n))) return false;
  return true;
}

// --- Coverage evaluation ----------------------------------------------------

function evaluateCoverage(activeTasks, tasksCovered, tasksDeferred) {
  const coveredSet = new Set(tasksCovered);
  const deferredSet = new Set(tasksDeferred);

  const covered = [];
  const deferred = [];
  const missing = [];

  for (const task of activeTasks) {
    if (coveredSet.has(task.id)) {
      covered.push(task);
    } else if (deferredSet.has(task.id)) {
      deferred.push(task);
    } else {
      missing.push(task);
    }
  }

  return { covered, deferred, missing };
}

// --- Verdict construction ---------------------------------------------------

function buildVerdict(featureName, activeTasks, coverage) {
  const { covered, deferred, missing } = coverage;
  const blockers = missing.length;
  const warnings = deferred.length;

  let verdict;
  if (blockers > 0) {
    verdict = 'BLOCK';
  } else if (warnings > 0) {
    verdict = 'REVISE';
  } else {
    verdict = 'APPROVED';
  }

  const summaryLines = [
    `Completeness check: ${activeTasks.length} task(s) reviewed`,
    `- Covered: ${covered.length}`,
    `- Deferred: ${deferred.length} (warnings)`,
    `- Missing: ${missing.length} (blockers)`,
  ];

  for (const task of missing) {
    summaryLines.push(`BLOCK: Task ${task.id} not addressed — "${task.title}"`);
  }
  for (const task of deferred) {
    summaryLines.push(`WARN: Task ${task.id} deferred — "${task.title}"`);
  }

  const signal = `[reviewer-verdict] {"agent":"completeness-checker","verdict":"${verdict}","blockers":${blockers},"warnings":${warnings},"feature":"${featureName}","model":"deterministic-script"}`;

  return {
    verdict,
    blockers,
    warnings,
    feature: featureName,
    summary: summaryLines.join('\n'),
    signal,
    covered: covered.map(t => t.id),
    deferred: deferred.map(t => t.id),
    missing: missing.map(t => t.id),
  };
}

// --- Main export ------------------------------------------------------------

export function runCompletenessCheck(root) {
  const planPath = path.join(root, 'docs', 'PLAN.md');
  const planContent = readFileSafe(planPath);

  if (planContent === null) {
    return { ok: false, reason: 'PLAN.md missing or unreadable' };
  }

  const sidecarPath = path.join(root, 'docs', 'context', 'coder-status.json');
  const sidecar = readJsonSafe(sidecarPath);

  if (!validateSidecar(sidecar)) {
    return { ok: false, reason: 'coder-status.json missing, malformed, or lacks tasksCovered/tasksDeferred arrays — fallback to agent' };
  }

  const { lines: sectionLines, featureName } = extractActiveFeatureSection(planContent);
  const { tasks: activeTasks, error: parseError } = extractActiveTaskIds(sectionLines);

  if (parseError) {
    return { ok: false, reason: parseError };
  }

  const coverage = evaluateCoverage(activeTasks, sidecar.tasksCovered, sidecar.tasksDeferred);
  const verdict = buildVerdict(featureName, activeTasks, coverage);

  return { ok: true, verdict };
}

// --- CLI wrapper ------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) {
      root = path.resolve(args[i + 1]);
      i++;
    }
  }

  if (!dirExists(root)) {
    log(`error: root directory does not exist: ${root}`);
    process.exit(1);
  }

  log(`checking: ${root}`);

  const result = runCompletenessCheck(root);

  if (!result.ok) {
    log(`fallback: ${result.reason}`);
    process.stdout.write(JSON.stringify({ ok: false, reason: result.reason }, null, 2) + '\n');
    process.exit(1);
  }

  log(result.verdict.summary.split('\n')[0]);
  log(result.verdict.signal);
  process.stdout.write(JSON.stringify({
    ok: true,
    verdict: result.verdict,
  }, null, 2) + '\n');
  process.exit(0);
}

main();
