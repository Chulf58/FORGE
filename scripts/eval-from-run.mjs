#!/usr/bin/env node
// @covers scripts/eval-from-run.mjs
// Graduation helper — auto-generates eval scenario files from a completed pipeline run.
//
// Usage:
//   node scripts/eval-from-run.mjs --run-id <runId>
//
// Exit codes:
//   0 — scenarios written (some may be WEAK and quarantined to needs-review/)
//   1 — validation failure, invalid token, or missing run

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScenario } from '../evals/scenario-schema.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// The script root (where evals/ lives) is resolved from process.cwd() so that
// tests can override it by setting cwd to a temp directory.
// Fall back to the real project root (one level up from scripts/) when cwd doesn't
// have a .pipeline/ subdirectory.
const cwd = process.cwd();

// ── Parse CLI flags ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const runIdIdx = args.indexOf('--run-id');
if (runIdIdx === -1 || !args[runIdIdx + 1]) {
  process.stderr.write('[eval-from-run] ERROR: --run-id <runId> is required\n');
  process.exit(1);
}
const runId = args[runIdIdx + 1];

// ── Token validation ──────────────────────────────────────────────────────────
const TOKEN_PATTERN = /^[a-zA-Z0-9_:-]+$/;

/**
 * Validates that a path token contains only safe characters.
 * @param {string} token
 * @returns {boolean}
 */
function isValidToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

// ── Sensitive-data sanitizer ──────────────────────────────────────────────────
/** Field names (case-insensitive) whose values must be redacted. */
const REDACTED_FIELD_NAMES = new Set([
  'apikey', 'api_key', 'token', 'password', 'secret',
  'authorization', 'auth', 'credential', 'credentials', 'bearer',
]);

/** Credential regex patterns for value scanning. */
const CREDENTIAL_PATTERNS = [
  /sk-ant-[a-zA-Z0-9_-]+/g,
  /sk-proj-[a-zA-Z0-9_-]+/g,
  /ghp_[a-zA-Z0-9]+/g,
  /gho_[a-zA-Z0-9]+/g,
  /ghu_[a-zA-Z0-9]+/g,
  /xox[bpoa]-[a-zA-Z0-9-]+/g,
  /AKIA[0-9A-Z]{16}/g,
];

/**
 * Sanitize an object deeply — redacts sensitive field names and regex-matched values.
 *
 * @param {unknown} value
 * @returns {{ sanitized: unknown, fieldRedactions: number, valueRedactions: number }}
 */
function sanitize(value) {
  let fieldRedactions = 0;
  let valueRedactions = 0;

  /**
   * @param {unknown} v
   * @returns {unknown}
   */
  function walk(v) {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') {
      let result = v;
      for (const pattern of CREDENTIAL_PATTERNS) {
        // Create fresh RegExp per call — avoid shared lastIndex state on /g patterns
        const fresh = new RegExp(pattern.source, pattern.flags);
        const matches = result.match(fresh);
        if (matches) {
          valueRedactions += matches.length;
          result = result.replace(new RegExp(pattern.source, pattern.flags), '[REDACTED-VALUE]');
        }
      }
      return result;
    }
    if (Array.isArray(v)) {
      return v.map(walk);
    }
    if (typeof v === 'object') {
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const [k, val] of Object.entries(/** @type {Record<string, unknown>} */ (v))) {
        if (REDACTED_FIELD_NAMES.has(k.toLowerCase())) {
          out[k] = '[REDACTED-FIELD]';
          fieldRedactions++;
        } else {
          out[k] = walk(val);
        }
      }
      return out;
    }
    return v;
  }

  const sanitized = walk(value);
  return { sanitized, fieldRedactions, valueRedactions };
}

// ── Run data loading ──────────────────────────────────────────────────────────

/**
 * Resolve the project root containing .pipeline/runs/.
 * Search order:
 *   1. process.cwd() — used by tests that set cwd to a temp dir
 *   2. The real project root (one level up from scripts/) — used in production
 *   3. Worktree parent (two levels up from scripts/) — used when running from a worktree
 * Returns the first path where .pipeline/runs exists.
 * @returns {string}
 */
function resolveProjectRoot() {
  const candidates = [cwd];

  // Real project root = one level up from the scripts/ directory
  const scriptProjectRoot = join(__dirname, '..');
  if (scriptProjectRoot !== cwd) {
    candidates.push(scriptProjectRoot);
  }

  // Worktree parent = two levels up when scripts/ is inside a .worktrees/<runId>/ subtree
  const normalized = scriptProjectRoot.replace(/\\/g, '/');
  if (normalized.includes('/.worktrees/')) {
    const worktreeParent = join(scriptProjectRoot, '..', '..');
    candidates.push(worktreeParent);
  }

  for (const candidate of candidates) {
    if (existsSync(join(candidate, '.pipeline', 'runs'))) {
      return candidate;
    }
  }

  // Fall back to cwd — let missing-run error surface naturally
  return cwd;
}

const projectRoot = resolveProjectRoot();
const runJsonPath = join(projectRoot, '.pipeline', 'runs', runId, 'run.json');

if (!existsSync(runJsonPath)) {
  process.stderr.write(
    `[eval-from-run] ERROR: run.json not found at ${runJsonPath}\n`,
  );
  process.exit(1);
}

/** @type {Record<string, unknown>} */
let runData;
try {
  const parsed = JSON.parse(readFileSync(runJsonPath, 'utf-8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    process.stderr.write('[eval-from-run] ERROR: run.json is not a JSON object\n');
    process.exit(1);
  }
  runData = /** @type {Record<string, unknown>} */ (parsed);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[eval-from-run] ERROR: failed to parse run.json: ${message}\n`);
  process.exit(1);
}

// ── Extract agent types from run ──────────────────────────────────────────────

/** @type {string[]} */
const agentTypes = [];
if (Array.isArray(runData.agents)) {
  for (const entry of runData.agents) {
    if (
      entry !== null &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      typeof (/** @type {Record<string, unknown>} */ (entry)).agentType === 'string'
    ) {
      const t = String(/** @type {Record<string, unknown>} */ (entry).agentType).trim();
      if (t && !agentTypes.includes(t)) {
        agentTypes.push(t);
      }
    }
  }
}

if (agentTypes.length === 0) {
  process.stderr.write(
    `[eval-from-run] WARNING: no agent types found in run.json for ${runId}\n`,
  );
  process.stderr.write('[eval-from-run] strong: 0, weak: 0 (quarantined to needs-review/)\n');
  process.exit(0);
}

// ── Validate all agent tokens BEFORE any path construction ───────────────────
// Per AC-12 observable (5): all tokens must be validated before any file is written.
// Both the full agentType and the short name (prefix-stripped) are used in paths.
for (const agentType of agentTypes) {
  if (!isValidToken(agentType)) {
    process.stderr.write(
      `[eval-from-run] ERROR: invalid agent token "${agentType}" — must match ^[a-zA-Z0-9_:-]+$\n`,
    );
    process.exit(1);
  }
  // Also validate the short name used as directory component
  const shortName = agentType.replace(/^forge:/, '');
  if (!isValidToken(shortName)) {
    process.stderr.write(
      `[eval-from-run] ERROR: invalid agent short-name token "${shortName}" — must match ^[a-zA-Z0-9_:-]+$\n`,
    );
    process.exit(1);
  }
}

// ── Signal extraction ─────────────────────────────────────────────────────────
const KNOWN_SIGNALS = [
  '[todo]', '[reviewer-verdict]', 'APPROVED', 'REVISE', 'BLOCK',
  'PASS', 'FAIL', '[forge-worker]', '## Files', 'handoff.md',
  'docs/context/', '[eval-from-run]', '[suggest]', '[summary]',
];

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractSignals(text) {
  return KNOWN_SIGNALS.filter((sig) => text.includes(sig));
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractArtifacts(text) {
  /** @type {string[]} */
  const artifacts = [];
  const matches = text.match(/docs\/context\/[\w.-]+\.md/g) || [];
  for (const m of matches) {
    if (!artifacts.includes(m)) artifacts.push(m);
  }
  return artifacts;
}

// Read handoff for signal/artifact discovery — relative to projectRoot (resolved above)
let handoffText = '';
const handoffCandidates = [
  join(cwd, 'docs', 'context', 'handoff.md'),
  join(join(__dirname, '..'), 'docs', 'context', 'handoff.md'),
  join(projectRoot, 'docs', 'context', 'handoff.md'),
];
for (const hPath of handoffCandidates) {
  if (existsSync(hPath)) {
    try {
      handoffText = readFileSync(hPath, 'utf-8');
      break;
    } catch {
      // Non-fatal — try next path
    }
  }
}

// ── Build and write scenarios ─────────────────────────────────────────────────

// Output evals/ tree is relative to cwd so tests can direct output to temp dirs.
// In production cwd = project root (or worktree root), so evals/ lands in the right place.
const evalsDir = join(cwd, 'evals');
const liveTree = join(evalsDir, 'agent-prompts');
const reviewTree = join(evalsDir, 'needs-review');

let strongCount = 0;
let weakCount = 0;
let totalFieldRedactions = 0;
let totalValueRedactions = 0;

for (const agentType of agentTypes) {
  const agentShort = agentType.replace(/^forge:/, '');

  // Build signals — start from handoff, then add agent-type defaults
  const baseSignals = extractSignals(handoffText);

  if (agentType.startsWith('forge:reviewer-')) {
    for (const s of ['APPROVED', 'BLOCK', 'REVISE', '[reviewer-verdict]']) {
      if (!baseSignals.includes(s)) baseSignals.push(s);
    }
  }
  if (['forge:coder', 'forge:debug', 'forge:refactor'].includes(agentType)) {
    for (const s of ['docs/context/handoff.md', '## Files']) {
      if (!baseSignals.includes(s)) baseSignals.push(s);
    }
  }
  if (agentType === 'forge:planner') {
    for (const s of ['[todo]', 'Verify:', 'AC-']) {
      if (!baseSignals.includes(s)) baseSignals.push(s);
    }
  }

  const artifacts = extractArtifacts(handoffText);
  if (
    ['forge:coder', 'forge:debug', 'forge:refactor'].includes(agentType) &&
    !artifacts.includes('docs/context/handoff.md')
  ) {
    artifacts.push('docs/context/handoff.md');
  }

  // Build candidate scenario — use agentShort (no forge: prefix) for the agent field
  // and directory name to match the existing evals/agent-prompts/<shortname>/ convention
  // and to avoid Windows path issues (colon is forbidden in directory names on Windows).
  /** @type {Record<string, unknown>} */
  const candidate = {
    agent: agentShort,
    name: `from-run-${runId}-${agentShort}`,
    description: `Auto-graduated from run ${runId} — agent ${agentType}`,
    expected_signals: [...new Set(baseSignals)],
    expected_artifacts: [...new Set(artifacts)],
    metadata: {
      source: `run:${runId}`,
      agentType,
      graduatedAt: new Date().toISOString(),
    },
  };

  // Sanitize BEFORE schema validation
  const { sanitized, fieldRedactions, valueRedactions } = sanitize(candidate);
  totalFieldRedactions += fieldRedactions;
  totalValueRedactions += valueRedactions;

  // Schema validation on sanitized output
  const validation = validateScenario(sanitized);
  if (!validation.ok) {
    process.stderr.write(
      `[eval-from-run] ERROR: schema validation failed for ${agentType}: ${validation.errors.join('; ')}\n`,
    );
    process.exit(1);
  }

  // STRONG/WEAK classification
  const rec = /** @type {Record<string, unknown>} */ (sanitized);
  const sigArr = Array.isArray(rec.expected_signals)
    ? /** @type {unknown[]} */ (rec.expected_signals)
    : [];
  const artArr = Array.isArray(rec.expected_artifacts)
    ? /** @type {unknown[]} */ (rec.expected_artifacts)
    : [];
  const isStrong = sigArr.length > 0 || artArr.length > 0;

  const targetDir = isStrong ? join(liveTree, agentShort) : join(reviewTree, agentShort);
  const filename = `from-run-${runId}-${agentShort}.json`;

  try {
    mkdirSync(targetDir, { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[eval-from-run] ERROR: could not create directory ${targetDir}: ${message}\n`,
    );
    process.exit(1);
  }

  try {
    writeFileSync(
      join(targetDir, filename),
      JSON.stringify(sanitized, null, 2) + '\n',
      'utf-8',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[eval-from-run] ERROR: failed to write scenario: ${message}\n`,
    );
    process.exit(1);
  }

  if (isStrong) {
    strongCount++;
  } else {
    weakCount++;
  }
}

// ── Summary output ────────────────────────────────────────────────────────────
if (totalFieldRedactions > 0 || totalValueRedactions > 0) {
  process.stderr.write(
    `[eval-from-run] sanitized: ${totalFieldRedactions} field-name redactions, ${totalValueRedactions} regex-value redactions\n`,
  );
}
process.stderr.write(
  `[eval-from-run] strong: ${strongCount}, weak: ${weakCount} (quarantined to needs-review/)\n`,
);

process.exit(0);
