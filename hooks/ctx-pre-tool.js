'use strict';

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { STDIN_TIMEOUT_LONG, findActiveRun } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_LONG;

function exitOk() {
  process.exit(0);
}

/**
 * Read the active run's worktreePath from the per-run active file, if any.
 * Enumerates .pipeline/runs/*/run.json to find the active run, then reads
 * its per-run run-active.json for worktreePath.
 * Returns null when no active run, no worktreePath, or the file is unreadable.
 */
async function readActiveWorktreePath(projectDir) {
  try {
    const active = await findActiveRun(projectDir);
    if (!active) return null;
    const runId = active.runId;
    if (!runId || !/^r-[a-zA-Z0-9]+$/.test(runId)) return null;
    const perRunPath = path.join(projectDir, '.pipeline', 'runs', runId, 'run-active.json');
    const raw = await fs.promises.readFile(perRunPath, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data.worktreePath === 'string' && data.worktreePath
      ? data.worktreePath
      : null;
  } catch (_) {
    return null;
  }
}

/**
 * Return true when absFilePath is inside worktreeAbs (or equals it).
 * Comparison is case-insensitive on Windows and tolerant of slash direction.
 */
function isInside(absFilePath, worktreeAbs) {
  const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  const f = norm(absFilePath);
  const w = norm(worktreeAbs);
  return f === w || f.startsWith(w + '/');
}

/**
 * Check whether a normalized relative file path matches one of the allowedPaths
 * patterns defined in agent-roles.json.
 *
 * Pattern semantics:
 *   exact string — e.g. "docs/PLAN.md"     -> strict equality after normalize
 *   "dir/**"     — e.g. "docs/tests/**"    -> startsWith the dir segment
 *   "*.config.*" — e.g. "*.config.js"      -> basename contains ".config."
 */
function matchesPattern(normalizedFilePath, pattern) {
  const normPattern = path.normalize(pattern);

  // Recursive glob: "docs/tests/**" or "src/**"
  if (pattern.endsWith('/**')) {
    const base = path.normalize(pattern.slice(0, -3));
    return (
      normalizedFilePath === base ||
      normalizedFilePath.startsWith(base + path.sep) ||
      normalizedFilePath.startsWith(base + '/')
    );
  }

  // Wildcard basename like "*.config.*"
  if (normPattern.startsWith('*')) {
    const basename = path.basename(normalizedFilePath);
    // "*.config.*" -> basename contains ".config."
    const inner = normPattern.replace(/^\*/, '').replace(/\*$/, '');
    return basename.includes(inner) || basename === normPattern;
  }

  // Exact match (covers "docs/PLAN.md", "package.json", etc.)
  return normalizedFilePath === normPattern;
}

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { exitOk(); return; }

  const toolName  = payload.tool_name;
  const toolInput = payload.tool_input || {};
  const agentType = payload.agent_type || null;

  // Only enforce on Write and Edit
  if (toolName !== 'Write' && toolName !== 'Edit') { exitOk(); return; }

  // If no agent_type, this is the orchestrator context — pass through
  if (!agentType) { exitOk(); return; }

  // Read the role manifest from CWD (.pipeline/agent-roles.json)
  const manifestPath = path.join(process.cwd(), '.pipeline', 'agent-roles.json');
  let manifest;
  try {
    const raw = await fs.promises.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch (_) {
    // Manifest absent or malformed — fail open (project has not opted in, or manifest broken)
    process.stderr.write('[ctx-pre-tool] agent-roles.json absent or unreadable — skipping enforcement\n');
    exitOk();
    return;
  }

  // Look up the agent in the manifest
  const role = manifest[agentType];
  if (!role) {
    // Unknown agent — fail open
    exitOk();
    return;
  }

  // Read-only agents: deny all writes unconditionally
  if (role.readonly === true) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Agent '${agentType}' is read-only and may not Write or Edit files.`,
        },
      }) + '\n'
    );
    exitOk();
    return;
  }

  // Agents with explicit empty allowedPaths array (e.g. integrity-checker) — deny all writes
  if (Array.isArray(role.allowedPaths) && role.allowedPaths.length === 0) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Agent '${agentType}' has no permitted write targets (allowedPaths is empty).`,
        },
      }) + '\n'
    );
    exitOk();
    return;
  }

  // Agents with allowedPaths — check the file path against patterns
  if (Array.isArray(role.allowedPaths)) {
    const rawFilePath = toolInput.file_path || toolInput.path || null;
    if (!rawFilePath) {
      // No file path extractable — fail open
      exitOk();
      return;
    }

    // Normalize to a relative path for comparison.
    // If the active run has a worktreePath and the target file is inside it,
    // relativize against the worktree root so patterns like "src/**" match
    // writes inside .worktrees/<runId>/. Otherwise relativize against CWD.
    let normalizedPath;
    try {
      const worktreePath = await readActiveWorktreePath(process.cwd());
      let relBase = process.cwd();
      if (
        worktreePath &&
        path.isAbsolute(rawFilePath) &&
        isInside(rawFilePath, worktreePath)
      ) {
        relBase = worktreePath;
      }
      const resolved = path.isAbsolute(rawFilePath)
        ? path.relative(relBase, rawFilePath)
        : rawFilePath;
      normalizedPath = path.normalize(resolved);
    } catch (_) {
      // path.relative can throw if paths are on different Windows drives — fail open
      exitOk();
      return;
    }

    // Check against each allowed pattern
    const allowed = role.allowedPaths.some(p => matchesPattern(normalizedPath, p));

    if (!allowed) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `Agent '${agentType}' is not permitted to write '${rawFilePath}'. Allowed targets: ${role.allowedPaths.join(', ')}. Role manifest: .pipeline/agent-roles.json`,
          },
        }) + '\n'
      );
      exitOk();
      return;
    }
  }

  exitOk();
}

// Read stdin with timeout guard
let inputData = '';
const timer = setTimeout(() => {
  main(inputData || '{}').catch(() => process.exit(0));
}, STDIN_TIMEOUT_MS);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => { inputData += line + '\n'; });
rl.on('close', () => {
  clearTimeout(timer);
  main(inputData || '{}').catch(() => process.exit(0));
});
