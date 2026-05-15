import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

// -- Shared Zod schemas ------------------------------------------------------

// Run IDs are generated as "r-" followed by alphanumeric characters (e.g. r-d1afe1f3).
// Constraining at the Zod schema level means traversal/injection values are
// rejected at the MCP boundary before reaching any path.join or run lookup.
export const runIdSchema = z.string().regex(
  /^r-[a-zA-Z0-9]+$/,
  'runId must match r-<alnum> format (e.g. r-a1b2c3d4)'
);

// forge_resume_run accepts bare suffix without the "r-" prefix (auto-added by handler).
// The constraint still blocks traversal and injection — only relaxes the prefix requirement.
export const runIdOrBareSchema = z.string().regex(
  /^(r-)?[a-zA-Z0-9]+$/,
  'runId must be r-<alnum> or bare <alnum> suffix (e.g. r-a1b2c3d4 or a1b2c3d4)'
);

// -- Helpers -----------------------------------------------------------------

/**
 * Returns the MAIN project root, even when this MCP server is running inside
 * a worktree (e.g. spawned by a worker via mcp/forge-worker.mjs:307 with
 * cwd=worktree path).
 *
 * Why: all run-state operations (forge_update_run, forge_get_run,
 * forge_create_run, forge_advance_stage, etc.) operate on
 * <projectRoot>/.pipeline/runs/<runId>/run.json. That file MUST live in main's
 * .pipeline/, not worktree's, so the conductor and worker see the same state.
 * Without this resolution, worker writes go to <worktree>/.pipeline/runs/...
 * (because createWorktree's copyDirSync seeded the worktree with a snapshot of
 * .pipeline/) and main's stays stale — observed in r-61c6a00a where the worker
 * wrote gate-pending state to its worktree's run.json but the conductor read
 * main's empty one.
 *
 * Worktree-local needs (gate-pending.json, reset-pill) are handled by
 * runId-aware lookups (forge_check_gate uses run.worktreePath) or explicit
 * path helpers in mcp/lib/worker-paths.js — not by this resolver.
 *
 * The conductor's MCP server doesn't run inside a worktree, so the gitdir
 * check is a no-op for it and behavior is unchanged.
 */
export function resolveProjectDir() {
  const cwdOrEnv = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const gitFile = join(cwdOrEnv, '.git');
  try {
    const content = readFileSync(gitFile, 'utf8').trim();
    if (content.startsWith('gitdir:')) {
      const gitdir = content.replace('gitdir:', '').trim();
      const match = gitdir.match(/(.+)[/\\]\.git[/\\]worktrees[/\\]/);
      if (match) return resolve(match[1]);
      console.error('[forge-mcp] .git gitdir present but worktree pattern did not match: ' + gitdir);
    }
  } catch (err) {
    if (err.code !== 'EISDIR' && err.code !== 'ENOENT') {
      console.error('[forge-mcp] .git read failed: ' + err.message);
    }
  }
  return cwdOrEnv;
}

// Alias retained for callers that want to be explicit about wanting main's
// project root. Returns the same value as resolveProjectDir() now.
export function resolveMainProjectDir() {
  return resolveProjectDir();
}

export function readJsonSafe(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Atomic write via temp-file-rename to prevent partial reads by concurrent sessions.
export function writeJsonSafe(filePath, data) {
  const tmp = filePath + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, filePath);
}

export function readCriteria(runDir) {
  const criteriaPath = join(runDir, 'criteria.json');
  try {
    return JSON.parse(readFileSync(criteriaPath, 'utf8'));
  } catch {
    return { criteria: [] };
  }
}

export function writeCriteria(runDir, data) {
  const criteriaPath = join(runDir, 'criteria.json');
  writeJsonSafe(criteriaPath, data);
}

export function errorResult(msg) {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

export function textResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export function requirePipeline(projectDir) {
  const pipelineDir = join(projectDir, '.pipeline');
  if (!existsSync(pipelineDir)) {
    return { ok: false, result: errorResult('Project not initialized — run /forge:init first') };
  }
  return { ok: true, pipelineDir };
}

export function hasGateApprovalToken(projectDir) {
  try {
    const tokenPath = join(projectDir, '.pipeline', 'action-approved.json');
    const raw = readFileSync(tokenPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.actions) || !data.expiresAt) return false;
    const expiresAt = new Date(data.expiresAt);
    if (isNaN(expiresAt.getTime()) || expiresAt < new Date()) return false;
    return data.actions.includes('gate-approve');
  } catch (_) {
    return false;
  }
}

// Case-insensitive on Windows; absolute-path equality after slash normalization.
// Used by forge_resume_run to verify the run's projectRoot matches the current project.
export function pathsEqual(a, b) {
  const A = resolve(a).replace(/\\/g, '/');
  const B = resolve(b).replace(/\\/g, '/');
  return process.platform === 'win32' ? A.toLowerCase() === B.toLowerCase() : A === B;
}

// Returns the full path of the first worker-task-<runId>.json found under
// dir/.pipeline/, or null if none exists. Used by recursive-spawn guards.
export function findWorkerTaskFile(dir) {
  const pipelineDir = join(dir, '.pipeline');
  try {
    const entries = readdirSync(pipelineDir);
    const match = entries.find((e) => /^worker-task-.+\.json$/.test(e));
    return match ? join(pipelineDir, match) : null;
  } catch {
    return null;
  }
}
