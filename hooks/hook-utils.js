'use strict';

const path = require('path');
const fsForRoot = require('fs');

// Marker cap: how many parent levels to walk before giving up the search.
// 10 is generous (deepest realistic monorepo subdir is ~4-5 levels).
const MONOREPO_WALK_MAX_DEPTH = 10;

/**
 * Walks up from `startDir` looking for a `.git` directory (the true repo root).
 *
 * `.git` as a DIRECTORY = real git repo root.
 * `.git` as a FILE = git worktree (handled by the worktree-suffix logic in
 * resolveProjectDir, not this helper).
 *
 * Returns the first ancestor (inclusive of startDir) containing a `.git`
 * directory, or null when no marker is found within MONOREPO_WALK_MAX_DEPTH.
 * Never throws.
 *
 * This closes the bug where the conductor session cwd is a monorepo subdir
 * (e.g. `packages/forge-core`) and the hook would otherwise write
 * `.pipeline/action-approved.json` into the subdir's pipeline dir while the
 * MCP server reads it from the project root — see TODO 250553e5.
 */
function findMonorepoRoot(startDir) {
  let dir = path.resolve(startDir);
  const fsRoot = path.parse(dir).root;
  for (let depth = 0; depth < MONOREPO_WALK_MAX_DEPTH; depth++) {
    const gitPath = path.join(dir, '.git');
    try {
      const stat = fsForRoot.statSync(gitPath);
      if (stat.isDirectory()) return dir;
    } catch (_) {
      // ENOENT or other — keep walking
    }
    if (dir === fsRoot) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolves the safe project directory from a hook stdin payload.
 *
 * Validates payload.cwd against process.cwd() to prevent a tampered payload
 * from redirecting hook file operations to an attacker-chosen directory.
 *
 * Validation rules:
 *   1. payload.cwd must be a non-empty string
 *   2. payload.cwd must be an absolute path
 *   3. payload.cwd must exactly match process.cwd()
 *
 * On any violation: falls back to process.cwd() and emits a stderr warning.
 * Never throws or returns an untrusted path.
 *
 * Monorepo handling: after validation, if the resolved cwd is a subdirectory
 * with no `.git` directory of its own but an ancestor `.git` directory exists
 * within MONOREPO_WALK_MAX_DEPTH levels, the ancestor is returned. This makes
 * the resolver agree with `mcp/lib/tools/shared.js:resolveProjectDir` when the
 * conductor session is launched from a monorepo subdir like
 * `<repo>/packages/forge-core` (TODO 250553e5). Returns the validated cwd
 * unchanged when no ancestor `.git` is found.
 *
 * @param {object} payload - parsed hook stdin payload
 * @returns {string} safe project directory — equals process.cwd() for non-worktree sessions,
 *   the main project root when process.cwd() is inside a .worktrees/r-<id> subdirectory,
 *   or the monorepo project root when process.cwd() is inside a workspace subdir.
 */
function resolveProjectDir(payload) {
  const actual = process.cwd();
  const fromPayload = (payload && typeof payload.cwd === 'string')
    ? payload.cwd.trim()
    : '';

  let resolved;
  if (!fromPayload) {
    resolved = actual;
  } else if (!path.isAbsolute(fromPayload)) {
    console.error(
      '[forge-hook] payload.cwd is not absolute ("' + fromPayload +
      '") — falling back to process.cwd()'
    );
    resolved = actual;
  } else if (fromPayload !== actual) {
    console.error(
      '[forge-hook] payload.cwd mismatch: received "' + fromPayload +
      '", expected "' + actual + '" — falling back to process.cwd()'
    );
    resolved = actual;
  } else {
    // FORGE worktrees live at <projectRoot>/.worktrees/r-[a-zA-Z0-9]+
    // When a hook fires inside a worktree session, process.cwd() and payload.cwd
    // both equal the worktree path — the validation above passes but the result
    // is wrong. Strip the suffix so all callers receive the main project root,
    // which is where .pipeline/ state always lives.
    const normalized = fromPayload.replace(/[/\\]+$/, '');
    const wtMatch = normalized.match(/^(.+)[/\\]\.worktrees[/\\]r-[a-zA-Z0-9]+$/i);
    if (wtMatch) return path.normalize(wtMatch[1]);
    resolved = fromPayload;
  }

  // Monorepo subdir promotion: if the resolved cwd has no `.git` directory of
  // its own but an ancestor does, return the ancestor. Safe no-op when cwd IS
  // the project root (findMonorepoRoot returns cwd itself).
  const monorepoRoot = findMonorepoRoot(resolved);
  if (monorepoRoot && monorepoRoot !== resolved) return monorepoRoot;
  return resolved;
}

/**
 * Resolves the safe plugin root for dynamic import() calls.
 *
 * Uses the hook file's own location as the trust anchor:
 *   path.resolve(__dirname, '..') — one level up from hooks/
 *
 * Validation rules for CLAUDE_PLUGIN_ROOT:
 *   1. If absent: use hook-derived root (no warning)
 *   2. If present but not absolute: warn + fall back
 *   3. If present, absolute, but mismatched after normalization: warn + fall back
 *   4. If present, absolute, matching: accept
 *
 * This prevents a tampered CLAUDE_PLUGIN_ROOT env var from redirecting
 * dynamic import() to attacker-controlled JS outside the plugin.
 *
 * @returns {string} safe plugin root path
 */
function resolvePluginRoot() {
  const trusted = path.resolve(__dirname, '..');
  const fromEnv = process.env.CLAUDE_PLUGIN_ROOT;
  if (!fromEnv) return trusted;

  if (!path.isAbsolute(fromEnv)) {
    console.error(
      '[forge-hook] CLAUDE_PLUGIN_ROOT is not absolute ("' + fromEnv +
      '") — falling back to hook-derived plugin root'
    );
    return trusted;
  }

  const normalized = path.normalize(fromEnv);
  if (normalized !== trusted) {
    console.error(
      '[forge-hook] CLAUDE_PLUGIN_ROOT mismatch: "' + normalized +
      '" !== "' + trusted + '" — falling back to hook-derived plugin root'
    );
    return trusted;
  }

  return normalized;
}

/**
 * Strips ANSI escape sequences and terminal control characters from a string
 * before it is written to terminal-facing output (console.error/log).
 *
 * Removes:
 *   - CSI sequences (\x1b[...m) — colour, cursor movement, clear-screen
 *   - OSC sequences (\x1b]...) — title-setting, hyperlinks
 *   - C0/C1 control characters except tab (\x09), newline (\x0a), carriage
 *     return (\x0d) — preserves readable whitespace, strips injection vectors
 *
 * Use on untrusted strings before including them in log messages:
 *   console.error('[hook] agentType=' + stripAnsi(agentType));
 *
 * @param {*} value - value to sanitize (coerced to string if not already)
 * @returns {string} printable string with escape sequences removed
 */
function stripAnsi(value) {
  const str = typeof value === 'string' ? value : String(value == null ? '' : value);
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')          // CSI sequences
    .replace(/\x1b\][^\x07\x1b]*[\x07\x1b\\]/g, '') // OSC sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, ''); // C0/C1 (keep \t \n \r)
}

/**
 * Checks whether a valid, non-expired approval token exists for the given action.
 * Shared implementation — used by bash-guard, workflow-guard, and any other hook
 * that needs to verify user approval.
 *
 * @param {string} action - action to check (e.g. 'commit', 'push', 'gate-approve')
 * @param {string} [projectDir] - project directory (defaults to process.cwd())
 * @returns {boolean}
 */
function hasValidApprovalToken(action, projectDir) {
  const fs = require('fs');
  try {
    const tokenPath = path.join(projectDir || process.cwd(), '.pipeline', 'action-approved.json');
    const raw = fs.readFileSync(tokenPath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.actions) || !data.expiresAt) return false;
    const expiresAt = new Date(data.expiresAt);
    if (isNaN(expiresAt.getTime()) || expiresAt < new Date()) return false;
    return data.actions.includes(action);
  } catch (_) {
    return false;
  }
}

// -- FORGE agent allowlist ---------------------------------------------------
// Derived from the plugin's agents/*.md filenames. Only events whose
// agent_type matches a known FORGE agent are recorded.

let _forgeAgents = undefined;
function getForgeAgentSet() {
  if (_forgeAgents !== undefined) return _forgeAgents;
  try {
    const pluginRoot = resolvePluginRoot();
    const agentsDir = path.join(pluginRoot, 'agents');
    const entries = require('fs').readdirSync(agentsDir);
    const names = entries.filter(n => n.endsWith('.md')).map(n => n.slice(0, -3));
    if (names.length === 0) { _forgeAgents = null; return _forgeAgents; }
    _forgeAgents = new Set(names);
    return _forgeAgents;
  } catch (_) {
    _forgeAgents = null;
    return _forgeAgents;
  }
}

function isForgeAgent(agentType) {
  if (!agentType) return false;
  const allowlist = getForgeAgentSet();
  if (!allowlist) return true;
  const normalized = agentType.startsWith('forge:') ? agentType.slice('forge:'.length) : agentType;
  return allowlist.has(normalized);
}

// -- Shared constants ---------------------------------------------------------

const STDIN_TIMEOUT_LONG = 10_000;
const STDIN_TIMEOUT_SHORT = 5000;

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'discarded']);

// -- Shared run-status reader -------------------------------------------------

/**
 * Read the status of a run from the local registry at
 * .pipeline/runs/<runId>/run.json. Returns the status string or null when
 * the run file is absent, unreadable, unparseable, or missing a status.
 * Defensive — never throws.
 */
function readRunStatus(projectDir, runId) {
  if (!runId || typeof runId !== 'string') return null;
  try {
    const fs = require('fs');
    const runPath = path.join(projectDir, '.pipeline', 'runs', runId, 'run.json');
    const raw = fs.readFileSync(runPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.status === 'string' ? parsed.status : null;
  } catch (_) {
    return null;
  }
}

// -- Active run scanner -------------------------------------------------------

/**
 * Enumerates .pipeline/runs/&lt;runId&gt;/run.json and returns the single non-terminal run.
 * Returns { runId, runData } when exactly one non-terminal run exists.
 * Returns null when zero or multiple non-terminal runs exist (fail-open per
 * RESEARCH.md line 49 — never pick a winner in an ambiguous tie-break).
 *
 * Uses fs.promises throughout. Never throws — all errors produce null.
 *
 * @param {string} projectDir - validated project root (from resolveProjectDir)
 * @returns {Promise<{ runId: string, runData: object }|null>}
 */
async function findActiveRun(projectDir) {
  const fs = require('fs');
  const runsDir = path.join(projectDir, '.pipeline', 'runs');
  let entries;
  try {
    entries = await fs.promises.readdir(runsDir);
  } catch (_) {
    // .pipeline/runs/ absent — no active run
    return null;
  }

  const active = [];
  for (const entry of entries) {
    const runPath = path.join(runsDir, entry, 'run.json');
    try {
      const raw = await fs.promises.readFile(runPath, 'utf8');
      const runData = JSON.parse(raw);
      const status = runData && typeof runData.status === 'string' ? runData.status : null;
      // Absent/unreadable status is treated as non-terminal (fail-open)
      if (!status || !TERMINAL_STATUSES.has(status)) {
        active.push({ runId: entry, runData });
      }
    } catch (_) {
      // Unreadable / unparseable — treat as non-terminal (fail-open)
      // but do NOT push without a runData object; skip this entry to avoid
      // operating on corrupted state.
    }
  }

  if (active.length !== 1) return null;
  return active[0];
}

const RUN_ID_RE = /^r-[a-zA-Z0-9]+$/;

/**
 * Resolve the active runId for a hook invocation. Closes f2f65ce9 — the
 * hook-side counterpart to singleton elimination (commit 8fc4f99c).
 *
 * Resolution order:
 *   1. process.env.FORGE_WORKER_RUN_ID (validated against RUN_ID_RE).
 *      Workers are spawned with this env var by mcp/server.js:1841 + :2698
 *      so this is the cheapest + most authoritative source.
 *   2. payload.cwd matching `.worktrees/<runId>/...` (also validated).
 *      Covers SessionStart payloads in worktree-backed runs.
 *   3. findActiveRun(projectDir) — pre-existing fail-open enumeration that
 *      returns null on zero or 2+ non-terminal runs.
 *
 * Returns the resolved runId string, or null when all three paths fail.
 * Never throws.
 *
 * Replaces direct findActiveRun() calls in subagent-stop.js, ctx-pre-tool.js,
 * and ctx-session-start.js so those hooks can attribute work to the correct
 * run even when 2+ non-terminal runs exist (the orphan-agent failure mode in
 * 7fe538ee sub-bug 2).
 *
 * @param {string} projectDir
 * @param {object} payload — hook stdin payload, may carry `cwd`
 * @returns {Promise<string|null>}
 */
async function resolveRunId(projectDir, payload) {
  // Step 1: env var precedence.
  const envRunId = process.env.FORGE_WORKER_RUN_ID;
  if (envRunId && typeof envRunId === 'string' && RUN_ID_RE.test(envRunId)) {
    return envRunId;
  }

  // Step 2: worktree-path detection from payload.cwd.
  if (payload && typeof payload.cwd === 'string' && payload.cwd) {
    // Match .worktrees/<runId> in the cwd, with platform-flexible separators.
    // Normalize separators so a single regex covers Windows and POSIX.
    const normalized = payload.cwd.replace(/\\/g, '/');
    const match = normalized.match(/[\/]\.worktrees[\/]([^\/]+)/);
    if (match && match[1] && RUN_ID_RE.test(match[1])) {
      return match[1];
    }
  }

  // Step 3: dispatch-context file — conductor writes this before in-session subagent dispatch.
  // Beats findActiveRun when 2+ non-terminal runs exist (ambiguous tie-break).
  try {
    const fs = require('fs');
    const ctxPath = path.join(projectDir, '.pipeline', 'dispatch-context.json');
    const raw = fs.readFileSync(ctxPath, 'utf8');
    const ctx = JSON.parse(raw);
    if (ctx && typeof ctx.runId === 'string' && RUN_ID_RE.test(ctx.runId)) {
      return ctx.runId;
    }
    // Invalid runId format — fall through silently.
  } catch (_) {
    // Absent or unreadable — fall through silently.
  }

  // Step 4: fall back to existing enumeration.
  const active = await findActiveRun(projectDir);
  return active ? active.runId : null;
}

// -- Feature matching (shared between workflow-guard and gate-sync) ------------

// Generic filler words stripped before comparison — these add no
// feature-identifying signal and cause false mismatches.
const FILLER_WORDS = new Set([
  'feature', 'features', 'the', 'a', 'an', 'for', 'and', 'of', 'in',
  'to', 'with', 'from', 'this', 'that', 'fix', 'add', 'update',
]);

function normalizeFeature(s) {
  if (!s || typeof s !== 'string') return '';
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function toMeaningfulWords(normalized) {
  return normalized.split(/\s+/).filter(w => w && !FILLER_WORDS.has(w));
}

// Strip trailing 's' for simple singular/plural tolerance.
function stemWord(word) {
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * Returns true when a and b refer to the same feature.
 *
 * Strategy:
 *   1. Normalise both: lowercase, collapse non-alphanumeric to spaces.
 *   2. Strip filler words (the, a, feature, fix, add, …).
 *   3. Stem remaining words (simple trailing-s removal).
 *   4. Every word in the shorter set must appear in the longer set.
 *
 * This is the authoritative implementation — used by workflow-guard (gate/handoff
 * comparison) and gate-sync (gate/run lookup). Both callers must use this
 * function so they can never disagree on whether two feature strings match.
 *
 * @param {string} a - first feature string
 * @param {string} b - second feature string
 * @returns {boolean}
 */
function featuresMatch(a, b) {
  const ga = normalizeFeature(a);
  const gb = normalizeFeature(b);
  if (!ga || !gb) return false;
  if (ga === gb) return true;

  const aWords = toMeaningfulWords(ga);
  const bWords = toMeaningfulWords(gb);
  if (aWords.length === 0 || bWords.length === 0) return false;

  const shorter = aWords.length <= bWords.length ? aWords : bWords;
  const longerStems = new Set(
    (aWords.length <= bWords.length ? bWords : aWords).map(stemWord)
  );

  return shorter.every(w => longerStems.has(stemWord(w)));
}

/**
 * Returns true when the project has been initialized (i.e. .pipeline/project.json
 * exists). Used by guards to skip control-file protection during /forge:init,
 * when the project directory has not yet been bootstrapped.
 *
 * @param {string} [projectDir] - project directory (defaults to process.cwd())
 * @returns {boolean}
 */
function isProjectInitialized(projectDir) {
  const fs = require('fs');
  try {
    return fs.existsSync(path.join(projectDir || process.cwd(), '.pipeline', 'project.json'));
  } catch (_) {
    return false;
  }
}

module.exports = {
  resolveProjectDir, resolvePluginRoot, stripAnsi, hasValidApprovalToken,
  getForgeAgentSet, isForgeAgent, isProjectInitialized,
  STDIN_TIMEOUT_LONG, STDIN_TIMEOUT_SHORT, TERMINAL_STATUSES, readRunStatus,
  findActiveRun, resolveRunId,
  normalizeFeature, toMeaningfulWords, stemWord, featuresMatch,
};
