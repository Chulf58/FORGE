'use strict';

// PreToolUse hook: enforce FORGE gate approvals before dispatching coder/implementer.
//
// WHY THIS EXISTS — 2026-04-18 live failure:
//   On two slices (observer-launcher, forge-config-migration), the main conversational
//   Claude reported reviewer verdicts and dispatched the implementer in the SAME turn,
//   collapsing Gate #2 into a status line with no human-in-loop pause.
//   The memory entry feedback_gate_approval.md was strengthened after the incident,
//   but the user explicitly requested mechanical enforcement — not just behavioral.
//
// WHAT THIS DOES:
//   Intercepts every Agent tool call. If the subagent_type is 'coder' (requires gate1
//   approved) or 'implementer' (requires gate2 approved), it reads
//   .pipeline/gate-pending.json and blocks the dispatch unless that gate is recorded
//   with status "approved".
//
// KNOWN LIMITATION:
//   This hook enforces that an approval *record exists on disk*, not that the orchestrator
//   actually presented the gate summary to the user and waited. The discipline of
//   presenting-and-waiting remains a behavioral constraint (memory + agent prompts).
//   A future improvement could cross-check gate.presentedAt against a session timestamp,
//   but that is out of scope here.
//
// TRIVIAL / SPRINT mode:
//   Both modes bypass gates by design (no reviewers, no approval steps). When
//   pipelineMode is 'TRIVIAL' or 'SPRINT', the hook exits cleanly with a stderr note.
//   Missing or malformed project.json: enforcement proceeds (safer default — do not
//   assume bypass when mode is unknown).

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const STDIN_TIMEOUT_MS = 10_000;

const GATE_AGENTS = {
  'coder': 'gate1',
  'implementer': 'gate2',
};

// Modes that bypass gates by design.
const BYPASS_MODES = new Set(['TRIVIAL', 'SPRINT']);

function exitOk() { process.exit(0); }

function exitBlock(msg) {
  // PreToolUse deny envelope — honored by the Claude Code validator.
  // stderr + exit 2 as belt-and-suspenders fallback.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: msg,
      },
    }) + '\n'
  );
  console.error(msg);
  process.exit(2);
}

function readJsonFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return { ok: false, missing: true, data: null };
  }
  try {
    return { ok: true, missing: false, data: JSON.parse(raw) };
  } catch (_) {
    return { ok: false, missing: false, data: null };
  }
}

async function main(rawInput) {
  // Step 1: parse payload — fail-open on parse error.
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { exitOk(); return; }

  // Step 2: only interested in Agent tool calls.
  if (payload.tool_name !== 'Agent') { exitOk(); return; }

  // Step 3: extract subagent_type.
  const rawType = payload.tool_input && payload.tool_input.subagent_type;
  if (!rawType || typeof rawType !== 'string') { exitOk(); return; }

  // Step 4: normalize — strip 'forge:' prefix if present (defensive).
  const subagentType = rawType.startsWith('forge:') ? rawType.slice(6) : rawType;

  // Step 5: only coder and implementer cross gates.
  const requiredGate = GATE_AGENTS[subagentType];
  if (!requiredGate) { exitOk(); return; }

  const projectDir = process.cwd();

  // Step 7: check pipelineMode — bypass for TRIVIAL and SPRINT.
  const projectJsonPath = path.join(projectDir, '.pipeline', 'project.json');
  const projectResult = readJsonFile(projectJsonPath);
  if (projectResult.ok && projectResult.data) {
    const mode = projectResult.data.pipelineMode;
    if (mode && BYPASS_MODES.has(mode)) {
      console.error('[gate-enforcement] pipelineMode ' + mode + ': gates bypassed by design');
      exitOk();
      return;
    }
  }
  // Missing or malformed project.json: proceed with normal enforcement.

  // Step 8: read gate-pending.json.
  const gatePath = path.join(projectDir, '.pipeline', 'gate-pending.json');
  const gateResult = readJsonFile(gatePath);

  if (!gateResult.ok) {
    exitBlock(
      'FORGE: Gate ' + requiredGate + ' has not been recorded for subagent "' + subagentType + '". ' +
      'Write .pipeline/gate-pending.json with status:"approved" (via /forge:approve or the ' +
      'forge_set_gate MCP tool) before dispatching this agent.'
    );
    return;
  }

  const gate = gateResult.data;

  // Require gate field to match expected gate stage.
  if (gate.gate !== requiredGate) {
    exitBlock(
      'FORGE: .pipeline/gate-pending.json is for ' + gate.gate + ' but subagent "' + subagentType +
      '" requires ' + requiredGate + ' approved. Mismatched gate pending.'
    );
    return;
  }

  // Require approved status.
  if (gate.status !== 'approved') {
    exitBlock(
      'FORGE: Gate ' + requiredGate + ' is pending (not approved) for feature "' +
      (gate.feature || 'unknown') + '". Present the gate summary to the user and await ' +
      'explicit approval before dispatching the ' + subagentType + '.'
    );
    return;
  }

  // Step 9: gate is present, correct stage, and approved — allow.
  exitOk();
}

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
