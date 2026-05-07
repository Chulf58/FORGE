#!/usr/bin/env node
// Verify citations in critic findings and promote verified findings to critic-verified.json.
//
// For each finding in docs/context/critic-findings.json:
//   - Checks that every cited file exists
//   - Checks that the cited line range is within the file's line count
//   - Checks that the evidence text approximately matches the source lines
//     (normalized-whitespace substring match — collapses runs of whitespace to a
//     single space and trims before comparing; tolerates minor reformatting but
//     will not match evidence fabricated from thin air)
//
// Tolerance threshold: normalization removes leading/trailing whitespace and
// collapses internal whitespace (tabs, multiple spaces, newlines) to single
// spaces. Evidence must appear as a substring of the normalized source window.
// No fuzzy score — substring presence is the binary gate.
//
// Usage:
//   node scripts/verify-critic-citations.mjs [--root <path>]
//
// Exit codes:
//   0 — at least one finding survived verification; critic-verified.json written
//   1 — zero findings survived verification (all dropped or no input)

import fs from 'node:fs';
import path from 'node:path';

function log(msg) {
  process.stderr.write(`[verify-critic-citations] ${msg}\n`);
}

// --- Helpers ------------------------------------------------------------------

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

/** Normalize whitespace: collapse runs of whitespace to a single space, trim. */
function normalizeWs(str) {
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Parse a line range string like "42-58" or "42" into [start, end] (1-based, inclusive).
 * Returns null if the string cannot be parsed.
 */
function parseLineRange(linesStr) {
  if (typeof linesStr !== 'string') return null;
  const trimmed = linesStr.trim();
  const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (start > end) return null;
    return [start, end];
  }
  const singleMatch = trimmed.match(/^(\d+)$/);
  if (singleMatch) {
    const n = parseInt(singleMatch[1], 10);
    return [n, n];
  }
  return null;
}

/**
 * Verify a single citation against the file system.
 * Returns { ok: boolean, reason?: string }.
 */
function verifyCitation(citation, rootDir) {
  const { file, lines, evidence } = citation;

  if (typeof file !== 'string' || !file) {
    return { ok: false, reason: 'citation.file is missing or not a string' };
  }
  if (typeof evidence !== 'string' || !evidence.trim()) {
    return { ok: false, reason: 'citation.evidence is missing or empty' };
  }

  const absPath = path.resolve(rootDir, file);
  if (!absPath.startsWith(rootDir + path.sep) && absPath !== rootDir) {
    return { ok: false, reason: `path traversal blocked: ${file}` };
  }
  const source = readFileSafe(absPath);
  if (source === null) {
    return { ok: false, reason: `file not found: ${file}` };
  }

  const sourceLines = source.split('\n');
  const totalLines = sourceLines.length;

  const range = parseLineRange(lines);
  if (!range) {
    return { ok: false, reason: `unparseable lines value: ${JSON.stringify(lines)}` };
  }
  const [start, end] = range;

  if (start < 1 || end > totalLines) {
    return {
      ok: false,
      reason: `line range ${start}-${end} out of bounds (file has ${totalLines} lines): ${file}`,
    };
  }

  // Extract the cited window (1-based inclusive → 0-based slice)
  const window = sourceLines.slice(start - 1, end).join('\n');
  const normalizedWindow = normalizeWs(window);
  const normalizedEvidence = normalizeWs(evidence);

  if (!normalizedWindow.includes(normalizedEvidence)) {
    // Fallback for regex/escape-heavy evidence: when the critic copies source
    // containing literal backslashes (e.g. /\\/g) into a JSON evidence string,
    // JSON parsing collapses each pair to one. Retry with backslashes doubled
    // before giving up.
    const doubledEvidence = normalizedEvidence.replace(/\\/g, '\\\\');
    if (doubledEvidence === normalizedEvidence || !normalizedWindow.includes(doubledEvidence)) {
      return {
        ok: false,
        reason: `evidence not found in lines ${start}-${end} of ${file}`,
      };
    }
  }

  return { ok: true };
}

/**
 * Verify all citations for a finding.
 * A finding passes if it has at least one citation AND all citations verify.
 * Returns { passed: boolean, failedCitations: string[] }.
 */
function verifyFinding(finding, rootDir) {
  const citations = finding.citations;

  if (!Array.isArray(citations) || citations.length === 0) {
    return { passed: false, failedCitations: ['no citations provided'] };
  }

  const failedCitations = [];
  for (const citation of citations) {
    const result = verifyCitation(citation, rootDir);
    if (!result.ok) {
      failedCitations.push(result.reason);
    }
  }

  return { passed: failedCitations.length === 0, failedCitations };
}

// --- Main ---------------------------------------------------------------------

function main() {
  // Support --root <path> for testability
  const args = process.argv.slice(2);
  let rootDir = process.cwd();
  const rootIdx = args.indexOf('--root');
  if (rootIdx !== -1 && args[rootIdx + 1]) {
    rootDir = path.resolve(args[rootIdx + 1]);
  }

  const findingsPath = path.join(rootDir, 'docs', 'context', 'critic-findings.json');
  const verifiedPath = path.join(rootDir, 'docs', 'context', 'critic-verified.json');

  log(`reading findings from ${findingsPath}`);
  const input = readJsonSafe(findingsPath);

  if (!input) {
    log('ERROR: could not read or parse critic-findings.json');
    process.exit(1);
  }

  const findings = Array.isArray(input.findings) ? input.findings : [];
  if (findings.length === 0) {
    log('WARNING: no findings in critic-findings.json');
    writeVerified(verifiedPath, [], input);
    process.exit(1);
  }

  const verified = [];
  const dropped = [];

  for (const finding of findings) {
    const { passed, failedCitations } = verifyFinding(finding, rootDir);
    if (passed) {
      verified.push(finding);
      log(`PASS: "${finding.title ?? '(untitled)'}"`);
    } else {
      dropped.push({ title: finding.title ?? '(untitled)', reasons: failedCitations });
      log(`DROP: "${finding.title ?? '(untitled)'}" — ${failedCitations.join('; ')}`);
    }
  }

  log(`verified: ${verified.length}, dropped: ${dropped.length}`);
  writeVerified(verifiedPath, verified, input);

  if (verified.length === 0) {
    log('ERROR: zero findings survived verification');
    process.exit(1);
  }

  process.exit(0);
}

function writeVerified(verifiedPath, findings, original) {
  const output = {
    findings,
    completedLenses: original.completedLenses ?? [],
    status: original.status ?? 'complete',
    verifiedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(verifiedPath), { recursive: true });
    fs.writeFileSync(verifiedPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
    log(`wrote ${findings.length} finding(s) to ${verifiedPath}`);
  } catch (err) {
    log(`ERROR: could not write verified findings: ${err.message}`);
  }
}

main();
