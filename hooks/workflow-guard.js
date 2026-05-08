'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { hasValidApprovalToken: hasValidApprovalTokenShared, resolveProjectDir, STDIN_TIMEOUT_LONG, featuresMatch, isProjectInitialized } = require('./hook-utils');

const STDIN_TIMEOUT_MS  = STDIN_TIMEOUT_LONG;

function exitOk() {
  process.exit(0);
}

function isSourceFile(filePath, { includeAgents = true } = {}) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalised = filePath.replace(/\\/g, '/');
  // Exclude pipeline, docs, config directories — everything else is source.
  // agents/ is excluded only for the advisory path (includeAgents: false).
  const excluded = [
    '/.pipeline/', '/docs/', '/.claude/', '/scaffolds/',
    '/node_modules/', '/.git/', '/mcp/', '/hooks/',
    '/skills/', '/bin/',
  ];
  if (!includeAgents) excluded.push('/agents/');
  for (const ex of excluded) {
    if (normalised.includes(ex)) return false;
  }
  // Exclude standalone config/doc files at project root
  if (normalised.endsWith('.md')) return false;
  if (normalised.endsWith('.json') && !normalised.includes('/src/')) return false;
  return true;
}

// -- Gate self-approval token check ------------------------------------------
function hasValidGateApprovalToken(projectDir) {
  return hasValidApprovalTokenShared('gate-approve', projectDir);
}

// -- Gate #2 enforcement for apply runs --------------------------------------
// Unconditional: if the active pipeline is "apply" and the write targets a
// source file, gate-pending.json must show gate2 approved AND the handoff
// must match the approved gate's feature. This prevents out-of-sequence
// source mutations and wrong-handoff application.

// runId validation guard — defence-in-depth before constructing per-run paths.
const RUN_ID_RE = /^r-[a-zA-Z0-9]+$/;

// Try to read .pipeline/runs/<runId>/run-active.json — returns null if absent or unreadable.
async function readPerRunActive(pipelineDir, runId) {
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) return null;
  try {
    const perRunPath = path.join(pipelineDir, 'runs', runId, 'run-active.json');
    const raw = await fs.promises.readFile(perRunPath, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch (_) {
    return null;
  }
}

// Scan .pipeline/runs/ for an active apply run via run.json registry.
// Returns the runId so callers can read the per-run active file when present.
async function findActiveApplyRun(pipelineDir) {
  const runsDir = path.join(pipelineDir, 'runs');
  let entries;
  try {
    entries = await fs.promises.readdir(runsDir, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = await fs.promises.readFile(path.join(runsDir, entry.name, 'run.json'), 'utf8');
      const data = JSON.parse(raw);
      if (data.pipelineType === 'apply' && data.status === 'running') {
        return { runId: data.runId || entry.name, pipelineType: 'apply', worktreePath: data.worktreePath || null };
      }
    } catch (_) {
      continue;
    }
  }
  return null;
}

// Returns null if write is allowed, or a deny-reason string if blocked.
// filePath is the absolute or relative path the Write/Edit targets.
async function checkApplyGateAndHandoff(filePath, projectDir) {
  // projectDir is resolved by the caller via resolveProjectDir(payload)
  const pipelineDir = path.join(projectDir, '.pipeline');

  // Resolve pipelineType and worktreePath exclusively from the run registry.
  // 1. Look up the apply run via findActiveApplyRun (reads run.json files).
  // 2. If found, try the per-run active file for more precise worktreePath.
  // 3. Fall back to registry-derived metadata when the per-run file is absent.
  let pipelineType = null;
  let worktreePath = null;
  const applyEntry = await findActiveApplyRun(pipelineDir);
  if (!applyEntry) {
    return null; // genuinely no active apply run
  }
  let perRunData = null;
  if (applyEntry.runId) {
    perRunData = await readPerRunActive(pipelineDir, applyEntry.runId);
  }
  if (perRunData) {
    pipelineType = perRunData.pipelineType || null;
    worktreePath = perRunData.worktreePath || null;
  } else {
    // Per-run active file absent — use registry-derived metadata.
    pipelineType = applyEntry.pipelineType;
    worktreePath = applyEntry.worktreePath;
  }

  if (pipelineType !== 'apply') return null;

  // This IS an apply run — check gate2 approval
  let gateFeature = null;
  try {
    const raw = await fs.promises.readFile(path.join(pipelineDir, 'gate-pending.json'), 'utf8');
    const gate = JSON.parse(raw);
    const isGate2Approved = gate.gate === 'gate2' && gate.status === 'approved';
    const isCommitGate = gate.gate === 'commit';
    if (!isGate2Approved && !isCommitGate) {
      return 'FORGE: Cannot write source files during /forge:apply \u2014 Gate #2 has not been approved. ' +
        'Run /forge:implement (or /forge:debug, /forge:refactor) and then /forge:approve before applying.';
    }
    gateFeature = gate.feature || '';
  } catch (_) {
    return 'FORGE: Cannot write source files during /forge:apply \u2014 gate-pending.json is missing or unreadable.';
  }

  // Gate2 is approved — now verify handoff matches the gate feature
  // When a worktreePath is set, read the handoff from there — the worktree holds
  // the feature-specific handoff while the main project may hold a different one.
  let handoffFeature = null;
  const handoffBase = worktreePath || projectDir;
  try {
    const raw = await fs.promises.readFile(path.join(handoffBase, 'docs', 'context', 'handoff.md'), 'utf8');
    const firstLine = raw.split('\n')[0] || '';
    // Extract feature name from "# Handoff: <name>" header
    const match = firstLine.match(/^#\s*Handoff:\s*(.+)/i);
    if (match) {
      handoffFeature = match[1].trim();
    }
  } catch (_) {
    // handoff missing or unreadable
  }

  if (!handoffFeature) {
    return 'FORGE: Cannot write source files during /forge:apply \u2014 docs/context/handoff.md is missing or has no "# Handoff: <name>" header.';
  }

  if (!featuresMatch(gateFeature, handoffFeature)) {
    return 'FORGE: Cannot write source files during /forge:apply \u2014 handoff does not match the approved gate. ' +
      'Gate #2 approved for "' + gateFeature + '" but handoff is "' + handoffFeature + '". ' +
      'Re-run the implement pipeline for this feature and approve Gate #2 again.';
  }

  // --- Worktree path enforcement ---
  // If the per-run active file has a worktreePath, source writes must be under it.
  // This prevents the implementer from writing to the main project when a
  // worktree was resolved. worktreePath is set by the apply skill in Step 2b.
  if (worktreePath) {
    const normalizedWrite = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
    const normalizedWt = path.resolve(worktreePath).replace(/\\/g, '/').toLowerCase();

    if (!normalizedWrite.startsWith(normalizedWt + '/') && normalizedWrite !== normalizedWt) {
      return 'FORGE: Cannot write source files to the main project during a worktree-backed apply. ' +
        'This apply run uses worktree: ' + worktreePath + '. ' +
        'All source file writes must target paths under that directory. ' +
        'Write to: ' + path.join(worktreePath, path.relative(projectDir, filePath));
    }
  }

  return null; // gate2 approved, handoff matches, path is valid — allow
}

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { exitOk(); return; }

  const projectDir = resolveProjectDir(payload);

  const toolName  = payload.tool_name;
  const toolInput = payload.tool_input || {};

  // Only act on Write and Edit
  if (toolName !== 'Write' && toolName !== 'Edit') { exitOk(); return; }

  // Extract file path — Write uses file_path, Edit uses file_path (confirmed by the main
  // process formatProgressLabel which reads input.file_path for both Write and Edit).
  // Fall back to path for robustness.
  const filePath = toolInput.file_path || toolInput.path || null;
  if (!filePath) { exitOk(); return; }

  // --- Unconditional gate + handoff + path enforcement for apply runs ---
  // This runs BEFORE the opt-in guard. It is not optional.
  // Checks: (1) gate2 approved, (2) handoff matches gate, (3) write path inside worktree.
  if (isSourceFile(filePath)) {
    const denyReason = await checkApplyGateAndHandoff(filePath, projectDir);
    if (denyReason) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: denyReason,
          },
        }) + '\n'
      );
      process.exit(2);
      return;
    }
  }

  // --- PLAN.md worktree boundary guard ---
  // Fires for both Write and Edit. When a plan worker running inside a worktree
  // attempts to write docs/PLAN.md to a path that resolves outside its own worktree
  // (e.g. the main project root), block with a descriptive error.
  //
  // Path resolution: toolInput.file_path with fallback to toolInput.path (mirrors doc-size-guard.js:30).
  // Normalization: lowercase + replace backslashes (mirrors lines 165-172 above).
  // Worktree detection: process.cwd() must match .worktrees/<runId>/ using RUN_ID_RE.
  {
    const rawTarget = toolInput.file_path || toolInput.path || null;
    if (rawTarget) {
      const normalizedTarget = path.resolve(rawTarget).replace(/\\/g, '/').toLowerCase();
      if (normalizedTarget.endsWith('docs/plan.md')) {
        const cwd = process.cwd().replace(/\\/g, '/');
        // Check if cwd is inside a worktree: must contain .worktrees/<runId>/ where runId matches RUN_ID_RE
        const worktreeMatch = cwd.match(/\.worktrees\/(r-[a-zA-Z0-9]+)(?:\/|$)/);
        if (worktreeMatch) {
          const normalizedCwd = cwd.toLowerCase();
          // Block only when the target path does NOT start with the worktree cwd
          if (!normalizedTarget.startsWith(normalizedCwd.replace(/\\/g, '/') + '/') && normalizedTarget !== normalizedCwd.replace(/\\/g, '/')) {
            process.stdout.write(
              JSON.stringify({
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                  permissionDecisionReason:
                    'FORGE: docs/PLAN.md must be written inside the worktree, not the main project root. ' +
                    'Offending path: ' + path.resolve(rawTarget) + '. ' +
                    'The plan worker cwd is ' + process.cwd() + '. ' +
                    'Write to: ' + path.join(process.cwd(), 'docs', 'PLAN.md') + ' instead.',
                },
              }) + '\n'
            );
            process.exit(2);
            return;
          }
        }
      }
    }
  }

  // --- Init-mode bypass: no project initialized yet, nothing to protect ---
  // When .pipeline/project.json does not exist, /forge:init is bootstrapping the
  // project for the first time. All control file guards are skipped — none of the
  // files they protect exist yet, and project.json must be created by init itself.
  if (!isProjectInitialized(projectDir)) { exitOk(); return; }

  // --- Control file guards: gate-pending.json, action-approved.json, etc. ---
  // Note: the legacy singleton .pipeline/run-active.json no longer exists; its
  // write-block check has been removed. Per-run active files at
  // .pipeline/runs/<runId>/run-active.json are managed exclusively by MCP tools
  // (forge_create_run, forge_resume_run, forge_advance_stage) and the
  // subagent-start/subagent-stop hooks. The bash-guard write-vector check
  // (`>\s*['"]?\.pipeline\//`) covers shell-redirect attempts; Write/Edit
  // attempts on per-run files are not currently blocked here.
  const normalisedPath = filePath.replace(/\\/g, '/');

  // Block ALL direct writes to action-approved.json.
  // Managed exclusively by approval-token.js (UserPromptSubmit hook) via fs.writeFileSync.
  // If the model could Write this file, it could forge approval tokens to bypass
  // bash-guard (commit/push) and gate self-approval checks.
  if (normalisedPath.endsWith('.pipeline/action-approved.json')) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'FORGE: Direct writes to .pipeline/action-approved.json are not allowed. ' +
            'Approval tokens are created automatically by the UserPromptSubmit hook ' +
            'when the user includes action keywords (commit, push, approve) in their message.',
        },
      }) + '\n'
    );
    process.exit(2);
    return;
  }

  // Block ALL direct writes to session-dispatch-log.json.
  // Managed exclusively by MCP server (appendDispatchLogEntry) after
  // forge_get_model_recommendation. If the model could Write this file, it could
  // forge dispatch log entries to bypass routing-enforcement.
  if (normalisedPath.endsWith('.pipeline/session-dispatch-log.json')) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'FORGE: Direct writes to .pipeline/session-dispatch-log.json are not allowed. ' +
            'Dispatch log entries are created automatically by forge_get_model_recommendation.',
        },
      }) + '\n'
    );
    process.exit(2);
    return;
  }

  // Block ALL direct writes to project.json.
  // Managed exclusively by MCP tools (forge_update_config, forge_read_project).
  if (normalisedPath.endsWith('.pipeline/project.json')) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'FORGE: Direct writes to .pipeline/project.json are not allowed. ' +
            'Use forge_update_config MCP tool to modify project settings.',
        },
      }) + '\n'
    );
    process.exit(2);
    return;
  }

  // Gate-pending.json: allow only pending writes (skill gate-presentation) or
  // writes with an explicit user approval token. Block everything else.
  if (normalisedPath.endsWith('.pipeline/gate-pending.json')) {
    let isApprovalWrite = false;
    let isPendingWrite = false;

    if (toolName === 'Write') {
      const content = toolInput.content || '';
      try {
        const parsed = JSON.parse(content);
        isApprovalWrite = parsed && parsed.status === 'approved';
        isPendingWrite = parsed && parsed.status === 'pending';
      } catch (_) {
        isApprovalWrite = /"status"\s*:\s*"approved"/.test(content);
        isPendingWrite = /"status"\s*:\s*"pending"/.test(content);
      }
    } else if (toolName === 'Edit') {
      const newString = toolInput.new_string || '';
      isApprovalWrite = /"status"\s*:\s*"approved"/.test(newString);
    }

    if (isApprovalWrite && !hasValidGateApprovalToken(projectDir)) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              'FORGE: Gate approval requires explicit user authorization. ' +
              'The user must invoke /forge:approve or include "approve" in their message ' +
              'before gate-pending.json can be written with status "approved". ' +
              'This prevents model self-approval of pipeline gates.',
          },
        }) + '\n'
      );
      process.exit(2);
      return;
    }

    if (!isPendingWrite && !hasValidGateApprovalToken(projectDir)) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              'FORGE: Direct writes to .pipeline/gate-pending.json require either ' +
              'status "pending" (gate presentation) or explicit user authorization via /forge:approve. ' +
              'Use forge_set_gate MCP tool for other gate state changes.',
          },
        }) + '\n'
      );
      process.exit(2);
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
