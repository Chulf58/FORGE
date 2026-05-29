#!/usr/bin/env node
// Gate-verification digest — read-only pre-approve evidence summary.
//
// Gathers run state, agent chain, plan/handoff/git signals and prints a
// structured digest to stdout so the conductor can review before typing `approve`.
//
// HARD INVARIANT (AC-4): this script is strictly read-only.
// stdout + stderr only — no state writes of any kind.
//
// Usage:
//   node scripts/gate-digest.mjs <runId> [--root <dir>]
//
// Exit codes:
//   0 — digest produced (even if some sections are degraded)
//   1 — fatal: runId missing or run.json unreadable after retries

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractActiveFeatureSection } from './lib/plan-utils.mjs';

// ---------------------------------------------------------------------------
// Stderr logger — never stdout (keeps stdout clean for machine consumption)
// ---------------------------------------------------------------------------

function log(msg) {
  process.stderr.write(`[gate-digest] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Safe readers — degrade benignly on missing/corrupt/mid-write files
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CLI arg helper (mirrors scripts/verify-output.mjs:77-81)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);

function getArg(prefix, args) {
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

// ---------------------------------------------------------------------------
// Git helpers — all wrapped in try/catch; non-zero or no-git → 'n/a'
// ---------------------------------------------------------------------------

function gitExec(worktreeDir, gitArgs) {
  try {
    return execFileSync('git', ['-C', worktreeDir, ...gitArgs], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Verify-line scanner for GATE1 section
//
// Scans each unchecked task in the plan section and checks that its Verify
// block contains all three slots: WHEN, Oracle, Observable.
// Returns array of { taskNum, missing[] } for tasks that fail the check.
// ---------------------------------------------------------------------------

function scanVerifyLines(sectionLines) {
  const failures = [];
  let currentTask = null;
  let verifyBlock = [];
  let inVerify = false;

  const flush = () => {
    if (currentTask === null) return;
    const text = verifyBlock.join(' ').toLowerCase();
    const missing = [];
    if (!/\bwhen\b/.test(text)) missing.push('WHEN');
    if (!/\boracle\b/.test(text)) missing.push('oracle');
    if (!/\bobservable\b/.test(text)) missing.push('observable');
    if (missing.length > 0) {
      failures.push({ taskNum: currentTask, missing });
    }
    currentTask = null;
    verifyBlock = [];
    inVerify = false;
  };

  for (const line of sectionLines) {
    // New unchecked task line
    const taskMatch = /^-\s+\[\s+\]\s+(\d+)\./.exec(line);
    if (taskMatch) {
      flush();
      currentTask = parseInt(taskMatch[1], 10);
      inVerify = false;
      verifyBlock = [];
      continue;
    }
    // Checked task or new section — flush current
    if (/^-\s+\[x\]/i.test(line) || /^#{1,4}\s/.test(line)) {
      flush();
      continue;
    }
    if (currentTask !== null) {
      // Detect Verify line
      if (/^\s+Verify\b/i.test(line)) {
        inVerify = true;
        verifyBlock.push(line);
      } else if (inVerify) {
        // Continue collecting indented continuation lines
        if (/^\s/.test(line)) {
          verifyBlock.push(line);
        } else {
          // Non-indented line ends the verify block
          inVerify = false;
        }
      }
    }
  }
  flush();
  return failures;
}

// ---------------------------------------------------------------------------
// Digest builder — pure, returns a string
// ---------------------------------------------------------------------------

function buildDigest(run, root) {
  const lines = [];

  const gate = run.gate || 'unknown';
  const gateStatus = (run.gateState && run.gateState.status) || 'unknown';
  const worktreePath = run.worktreePath || root;

  // --- RUN STATE section ---------------------------------------------------
  lines.push('=== RUN STATE ===');
  lines.push(`runId:          ${run.runId || '(unknown)'}`);
  lines.push(`feature:        ${run.feature || '(unknown)'}`);
  lines.push(`gate:           ${gate}`);
  lines.push(`gateState:      ${gateStatus}`);
  lines.push(`worktreePath:   ${worktreePath}`);
  lines.push(`classificationId: ${run.classificationId || '(none)'}`);
  lines.push('');

  // --- AGENT CHAIN section -------------------------------------------------
  lines.push('=== AGENT CHAIN ===');
  const agents = Array.isArray(run.agents) ? run.agents : [];
  if (agents.length === 0) {
    lines.push('  (no agents dispatched)');
  } else {
    for (const agent of agents) {
      const verdict = agent.verdict || agent.outcome || 'no-verdict';
      const reason = agent.reason || agent.failureReason || '';
      const firstReasonLine = reason ? reason.split('\n')[0].trim() : '';
      const suffix = verdict !== 'APPROVED' && firstReasonLine
        ? ` — ${firstReasonLine}`
        : '';
      lines.push(`  ${agent.agentType || '(unknown)'}  →  ${verdict}${suffix}`);
    }
  }
  lines.push('');

  // --- Gate-specific sections ----------------------------------------------

  if (gate === 'gate1') {
    lines.push('=== GATE1 ===');

    const planPath = path.join(worktreePath, 'docs', 'PLAN.md');
    const planContent = readFileSafe(planPath);

    if (planContent === null) {
      lines.push(`  PLAN.md: not found at ${planPath}`);
    } else {
      const planLines = planContent.split('\n');
      lines.push(`  PLAN.md: ${planPath} (${planLines.length} lines)`);

      const { lines: sectionLines, featureName } = extractActiveFeatureSection(planContent);

      // Count tasks in active section
      const unchecked = sectionLines.filter(l => /^-\s+\[\s+\]/.test(l));
      const checked = sectionLines.filter(l => /^-\s+\[x\]/i.test(l));

      // Wave distribution (lines starting with ## Wave or similar)
      const waveHeaders = sectionLines.filter(l => /^#{2,4}\s+(Wave|Phase)\s+\d/i.test(l));

      lines.push(`  active feature: ${featureName}`);
      lines.push(`  tasks: ${unchecked.length} open, ${checked.length} done`);
      if (waveHeaders.length > 0) {
        lines.push(`  waves: ${waveHeaders.length} (${waveHeaders.map(l => l.trim()).join(', ')})`);
      }

      // Verify-gate scan
      const verifyFailures = scanVerifyLines(sectionLines);
      if (verifyFailures.length === 0) {
        lines.push('  Verify-gate: OK');
      } else {
        for (const { taskNum, missing } of verifyFailures) {
          lines.push(`  Verify-gate: FAIL — task ${taskNum} (missing: ${missing.join(', ')})`);
        }
      }

      // Research-needed section
      const hasResearchNeeded = planContent.includes('### Research needed');
      if (hasResearchNeeded) {
        lines.push('  research-needed: section present');
      }
    }
    lines.push('');
  }

  if (gate === 'gate2') {
    lines.push('=== GATE2 ===');

    const handoffPath = path.join(worktreePath, 'docs', 'context', 'handoff.md');
    const handoffContent = readFileSafe(handoffPath);
    if (handoffContent === null) {
      lines.push(`  handoff.md: not found at ${handoffPath}`);
    } else {
      lines.push(`  handoff.md: ${handoffPath} (${handoffContent.split('\n').length} lines)`);
    }

    // git diff --name-only HEAD (changed files)
    const diffOutput = gitExec(worktreePath, ['diff', '--name-only', 'HEAD']);
    if (diffOutput === null) {
      lines.push('  git diff HEAD: n/a');
    } else if (diffOutput === '') {
      lines.push('  git diff HEAD: (no changed files)');
    } else {
      const changedFiles = diffOutput.split('\n').filter(Boolean);
      lines.push(`  git diff HEAD (${changedFiles.length} file(s)):`);
      for (const f of changedFiles) {
        lines.push(`    ${f}`);
      }
    }

    // Reviewer-output mtime staleness check
    const reviewerDir = path.join(root, '.pipeline', 'context', 'reviewer-output');
    try {
      const reviewerFiles = fs.readdirSync(reviewerDir).filter(f => f.endsWith('.md'));
      if (reviewerFiles.length === 0) {
        lines.push('  reviewer-output: (empty)');
      } else {
        lines.push(`  reviewer-output: ${reviewerFiles.length} file(s)`);
      }
    } catch {
      lines.push('  reviewer-output: (dir not found)');
    }

    lines.push('');
  }

  if (gate === 'commit') {
    lines.push('=== COMMIT ===');

    // git log --oneline -5
    const gitLog = gitExec(worktreePath, ['log', '--oneline', '-5']);
    if (gitLog === null) {
      lines.push('  git log: n/a');
    } else if (gitLog === '') {
      lines.push('  git log: (no commits)');
    } else {
      lines.push('  recent commits:');
      for (const l of gitLog.split('\n').filter(Boolean)) {
        lines.push(`    ${l}`);
      }
    }

    // git status --porcelain (uncommitted files)
    const gitStatus = gitExec(worktreePath, ['status', '--porcelain']);
    if (gitStatus === null) {
      // git unavailable in this directory — report as uncommitted (unknown)
      lines.push('  git status: n/a');
      lines.push('  Uncommitted: (git status unavailable)');
    } else if (gitStatus === '') {
      lines.push('  git status: clean');
    } else {
      const statusLines = gitStatus.split('\n').filter(Boolean);
      lines.push(`  git status (${statusLines.length} item(s)):`);
      for (const sl of statusLines) {
        const filePart = sl.slice(3).trim();
        lines.push(`  Uncommitted: ${filePart}`);
      }
    }

    // TODO-id extraction from feature name
    const featureName = run.feature || '';
    const todoIdMatch = /^([a-f0-9]{8})[:\s—]/.exec(featureName);
    if (todoIdMatch) {
      lines.push(`  source-TODO-id: ${todoIdMatch[1]}`);
    } else {
      lines.push(`  source-TODO-id: (not found in feature name: "${featureName}")`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);

  // First positional arg is runId; --root=<dir> or --root <dir>
  const runId = args.find(a => !a.startsWith('--'));
  let root = process.cwd();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) {
      root = path.resolve(args[i + 1]);
      i++;
    } else {
      const rootVal = getArg('--root=', [args[i]]);
      if (rootVal !== null) {
        root = path.resolve(rootVal);
      }
    }
  }

  if (!runId) {
    process.stderr.write('Usage: node scripts/gate-digest.mjs <runId> [--root <dir>]\n');
    process.exit(1);
  }

  const runJsonPath = path.join(root, '.pipeline', 'runs', runId, 'run.json');
  const run = readJsonSafe(runJsonPath);

  if (!run) {
    log(`error: could not read run.json at ${runJsonPath}`);
    process.exit(1);
  }

  log(`digest for run ${runId} (gate: ${run.gate || 'unknown'})`);

  const digest = buildDigest(run, root);
  process.stdout.write(digest + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Named export for testing
// ---------------------------------------------------------------------------

export { buildDigest };
