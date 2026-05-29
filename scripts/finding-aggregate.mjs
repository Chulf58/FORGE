#!/usr/bin/env node
// Aggregate FIND-N verdict lines from durable reviewer verdict files.
//
// Input:  .pipeline/context/verdicts/<runId>-<reviewer>-<phase>.md
// Output: docs/context/findings-verdict.json
//
// Reads and writes its own output only — touches no gate, no run.json.
//
// Usage (CLI):
//   node scripts/finding-aggregate.mjs --run-id=<runId> [--verdicts-dir=<path>] [--out=<path>]
//
// Exports:
//   parseFindingVerdicts(mdText)   → Array<{id, verdict}>
//   aggregateFindings(input)       → Record<findingId, {verdicts, decision}>

import fs from 'node:fs';
import path from 'node:path';

// FIND-<id>: CONFIRMED|DISMISSED|NEEDS-INVESTIGATION [optional trailing text]
const FIND_LINE_RE = /^FIND-([\w]+(?:-[\w]+)*): (CONFIRMED|DISMISSED|NEEDS-INVESTIGATION)(?:\s.*)?$/;

/**
 * Parse FIND-N verdict lines from a reviewer verdict markdown string.
 *
 * @param {string} mdText - raw markdown content of a verdict file
 * @returns {Array<{id: string, verdict: string}>}
 */
export function parseFindingVerdicts(mdText) {
  if (!mdText || typeof mdText !== 'string') {
    return [];
  }
  const results = [];
  for (const line of mdText.split(/\r?\n/)) {
    const match = FIND_LINE_RE.exec(line.trim());
    if (match) {
      results.push({ id: match[1], verdict: match[2] });
    }
  }
  return results;
}

/**
 * Aggregate per-finding verdict lists using precedence rules:
 *   any CONFIRMED         → 'blocker'
 *   any NEEDS-INVESTIGATION (no CONFIRMED) → 'revise'
 *   all DISMISSED         → 'cleared'
 *
 * @param {Record<string, string[]>} perFindingVerdictLists - findingId → array of verdict strings
 * @returns {Record<string, {verdicts: string[], decision: string}>}
 */
export function aggregateFindings(perFindingVerdictLists) {
  const result = {};
  for (const [findingId, verdicts] of Object.entries(perFindingVerdictLists)) {
    let decision;
    if (verdicts.includes('CONFIRMED')) {
      decision = 'blocker';
    } else if (verdicts.includes('NEEDS-INVESTIGATION')) {
      decision = 'revise';
    } else {
      decision = 'cleared';
    }
    result[findingId] = { verdicts, decision };
  }
  return result;
}

// ============================================================================
// CLI entry point
// ============================================================================

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (m) {
      args[m[1]] = m[2] !== undefined ? m[2] : true;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const runId = args['run-id'] || null;
  const verdictsDir = args['verdicts-dir'] || '.pipeline/context/verdicts';
  const outPath = args['out'] || 'docs/context/findings-verdict.json';

  // Discover verdict files — either scoped to runId or all
  let files;
  try {
    const entries = fs.readdirSync(verdictsDir);
    files = entries
      .filter(f => f.endsWith('.md') && (!runId || f.startsWith(runId + '-')))
      .map(f => path.join(verdictsDir, f));
  } catch (err) {
    process.stderr.write(`[finding-aggregate] cannot read verdicts dir ${verdictsDir}: ${err.message}\n`);
    process.exit(1);
  }

  if (files.length === 0) {
    process.stderr.write(`[finding-aggregate] no verdict files found in ${verdictsDir}${runId ? ` for run ${runId}` : ''}\n`);
    process.exit(0);
  }

  // Parse each file and build perFindingVerdictLists
  /** @type {Record<string, string[]>} */
  const perFinding = {};

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      process.stderr.write(`[finding-aggregate] skipping unreadable file ${filePath}: ${err.message}\n`);
      continue;
    }
    const findings = parseFindingVerdicts(content);
    for (const { id, verdict } of findings) {
      if (!perFinding[id]) {
        perFinding[id] = [];
      }
      perFinding[id].push(verdict);
    }
  }

  const aggregated = aggregateFindings(perFinding);

  // Build output JSON
  const output = {
    runId: runId || null,
    aggregated_at: new Date().toISOString(),
    findings: Object.entries(aggregated).map(([id, { verdicts, decision }]) => ({
      id,
      verdicts,
      decision,
    })),
  };

  // Write output (mirror writeFindingsJson style from reviewer-dispatch.mjs)
  try {
    const outDir = path.dirname(outPath);
    if (outDir && !fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  } catch (err) {
    process.stderr.write(`[finding-aggregate] failed to write ${outPath}: ${err.message}\n`);
    process.exit(1);
  }

  // Print summary to stderr
  const blockers = output.findings.filter(f => f.decision === 'blocker').length;
  const revises = output.findings.filter(f => f.decision === 'revise').length;
  const cleared = output.findings.filter(f => f.decision === 'cleared').length;
  process.stderr.write(
    `[finding-aggregate] ${output.findings.length} findings — ${blockers} blocker(s), ${revises} revise(s), ${cleared} cleared — written to ${outPath}\n`,
  );
}

// Run CLI when invoked directly
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  main();
}
