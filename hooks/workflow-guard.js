'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const STDIN_TIMEOUT_MS  = 10_000;

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'discarded']);

function exitOk() {
  process.exit(0);
}

function getSettingsPath() {
  // Matches Electron app.getPath('userData'): %APPDATA%\FORGE on Windows
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'FORGE', 'forge-settings.json');
  }
  // macOS: ~/Library/Application Support/FORGE
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'FORGE', 'forge-settings.json');
  }
  // Linux: ~/.config/FORGE
  return path.join(os.homedir(), '.config', 'FORGE', 'forge-settings.json');
}

async function isGuardEnabled() {
  try {
    const settingsPath = getSettingsPath();
    try {
      await fs.promises.access(settingsPath);
    } catch (_) {
      return false; // default: disabled if settings absent
    }
    const raw = await fs.promises.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(raw);
    return settings.workflowGuardEnabled === true;
  } catch (_) {
    return false; // default off on any error
  }
}

async function isPipelineActive() {
  const projectDir = process.cwd();
  const markerPath = path.join(projectDir, '.pipeline', 'run-active.json');
  let runId;
  try {
    const raw = await fs.promises.readFile(markerPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !data.runId) return false;
    runId = data.runId;
  } catch (_) {
    return false;
  }
  // Validate runId to prevent path traversal via a tampered run-active.json.
  if (!/^r-[a-zA-Z0-9-]+$/.test(runId)) return false;
  // Cross-reference the run registry for terminal status.
  // Fail-open: if run.json is absent or unreadable, treat as non-terminal.
  try {
    const runPath = path.join(projectDir, '.pipeline', 'runs', runId, 'run.json');
    const raw = await fs.promises.readFile(runPath, 'utf8');
    const run = JSON.parse(raw);
    if (run && run.status && TERMINAL_STATUSES.has(run.status)) return false;
  } catch (_) {
    // run.json absent or unreadable — fail open (non-terminal assumed)
  }
  return true;
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
// Mirrors bash-guard's hasValidApprovalToken but checks for 'gate-approve' action.
function hasValidGateApprovalToken() {
  try {
    const tokenPath = path.join(process.cwd(), '.pipeline', 'action-approved.json');
    const raw = fs.readFileSync(tokenPath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.actions) || !data.expiresAt) return false;
    const expiresAt = new Date(data.expiresAt);
    if (isNaN(expiresAt.getTime()) || expiresAt < new Date()) return false;
    return data.actions.includes('gate-approve');
  } catch (_) {
    return false;
  }
}

// -- Gate #2 enforcement for apply runs --------------------------------------
// Unconditional: if the active pipeline is "apply" and the write targets a
// source file, gate-pending.json must show gate2 approved AND the handoff
// must match the approved gate's feature. This prevents out-of-sequence
// source mutations and wrong-handoff application.

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
function stem(word) {
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function featuresMatch(gateFeature, handoffFeature) {
  const g = normalizeFeature(gateFeature);
  const h = normalizeFeature(handoffFeature);
  if (!g || !h) return false;
  if (g === h) return true;

  const gWords = toMeaningfulWords(g);
  const hWords = toMeaningfulWords(h);
  if (gWords.length === 0 || hWords.length === 0) return false;

  // The shorter side's meaningful words must all appear in the longer side
  // (with simple singular/plural tolerance via stem()).
  const shorter = gWords.length <= hWords.length ? gWords : hWords;
  const longerStems = new Set((gWords.length <= hWords.length ? hWords : gWords).map(stem));

  return shorter.every(w => longerStems.has(stem(w)));
}

// Returns null if write is allowed, or a deny-reason string if blocked.
// filePath is the absolute or relative path the Write/Edit targets.
async function checkApplyGateAndHandoff(filePath) {
  const projectDir = process.cwd();
  const pipelineDir = path.join(projectDir, '.pipeline');

  // Read run-active.json to check if this is an apply run
  let pipelineType = null;
  let worktreePath = null;
  try {
    const raw = await fs.promises.readFile(path.join(pipelineDir, 'run-active.json'), 'utf8');
    const data = JSON.parse(raw);
    pipelineType = data.pipelineType || null;
    worktreePath = data.worktreePath || null;
  } catch (_) {
    return null; // no active run — not an apply, nothing to block
  }

  if (pipelineType !== 'apply') return null;

  // This IS an apply run — check gate2 approval
  let gateFeature = null;
  try {
    const raw = await fs.promises.readFile(path.join(pipelineDir, 'gate-pending.json'), 'utf8');
    const gate = JSON.parse(raw);
    if (gate.gate !== 'gate2' || gate.status !== 'approved') {
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
  // If run-active.json has a worktreePath, source writes must be under it.
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
    const denyReason = await checkApplyGateAndHandoff(filePath);
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

  // --- Control file guards: run-active.json and gate-pending.json ---
  const normalisedPath = filePath.replace(/\\/g, '/');

  // Block ALL direct writes to run-active.json.
  // Managed exclusively by MCP tools (forge_create_run, forge_resume_run)
  // and hooks (subagent-start, subagent-stop). No legitimate Write/Edit path.
  if (normalisedPath.endsWith('.pipeline/run-active.json')) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'FORGE: Direct writes to .pipeline/run-active.json are not allowed. ' +
            'Use forge_create_run or forge_resume_run MCP tools to manage run state.',
        },
      }) + '\n'
    );
    process.exit(2);
    return;
  }

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
  // If the model could Write this file, it could downgrade pipelineMode to
  // SPRINT/TRIVIAL to bypass gate enforcement and reviewer dispatch.
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

    if (isApprovalWrite && !hasValidGateApprovalToken()) {
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

    if (!isPendingWrite && !hasValidGateApprovalToken()) {
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

  // --- Opt-in advisory guard (existing behavior) ---

  // Opt-in check — off by default
  if (!(await isGuardEnabled())) { exitOk(); return; }

  // Pipeline active? No advisory needed.
  if (await isPipelineActive()) { exitOk(); return; }

  // Only warn for source files (advisory path excludes agents/)
  if (!isSourceFile(filePath, { includeAgents: false })) { exitOk(); return; }

  // Emit advisory via additionalContext (injected directly into Claude's active session)
  const advisory =
    'Advisory: This edit is happening outside a FORGE pipeline run. ' +
    "Changes won't be tracked in a handoff, won't have a TESTING.md checklist, " +
    "and won't be reviewed. Consider using FORGE's debug: or implement feature: " +
    'pipeline instead. (This is advisory only \u2014 the edit will proceed.)';
  process.stdout.write(JSON.stringify({ additionalContext: advisory }) + '\n');

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
