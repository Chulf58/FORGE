#!/usr/bin/env node
/**
 * audit-tool-calls.mjs — deterministic tool-call anti-pattern auditor
 *
 * Reads the session JSONL from os.tmpdir()/claude-audit-<sessionId>.jsonl
 * (resolved via os.tmpdir()/claude-audit-latest.txt when --session is omitted).
 * Detects four anti-patterns in one pass and appends findings to
 * <projectRoot>/docs/audit-log.jsonl.
 *
 * Anti-patterns:
 *   repeated-reads  — same file Read >3× in a session by the same agent
 *   blind-write     — Write/Edit called for a file never Read in the same session
 *   tool-storm      — >20 tool calls in a single agent turn
 *   role-violation  — conductor used Agent tool for ad-hoc work
 *
 * Usage:
 *   node scripts/audit-tool-calls.mjs --root <projectDir> [--session <id>]
 *   node scripts/audit-tool-calls.mjs --root <projectDir>   # falls back to pointer file
 */

import { readFileSync, appendFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import os from 'os';

// Ad-hoc / non-pipeline subagent types that are forbidden in conductor sessions.
// Pipeline skills are exempt. See CLAUDE.md "Conductor sessions".
const AD_HOC_AGENT_TYPES = new Set([
  'explore',
  'general-purpose',
  'claude-code-guide',
]);

function parseArgs(argv) {
  const args = { root: null, session: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) {
      args.root = argv[++i];
    } else if (argv[i] === '--session' && argv[i + 1]) {
      args.session = argv[++i];
    }
  }
  return args;
}

function resolveSessionId(explicit) {
  if (explicit) return explicit;
  try {
    const latestPath = join(os.tmpdir(), 'claude-audit-latest.txt');
    const content = readFileSync(latestPath, 'utf8').trim();
    return content || null;
  } catch (_) {
    return null;
  }
}

function resolveAuditPath(sessionId) {
  return join(os.tmpdir(), 'claude-audit-' + sessionId + '.jsonl');
}

function parseJsonl(filePath) {
  const entries = [];
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (_) {
    return entries; // absent or unreadable — graceful no-op
  }
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch (_) {
      // Malformed line — skip silently
    }
  }
  return entries;
}

/**
 * Check if the project is a conductor session (no worker-task.json present).
 * @param {string} projectRoot
 * @returns {boolean}
 */
function isConductorSession(projectRoot) {
  const workerTaskPath = join(projectRoot, '.pipeline', 'worker-task.json');
  return !existsSync(workerTaskPath);
}

/**
 * Read run-active.json to get the current runId (best-effort).
 * @param {string} projectRoot
 * @returns {string|null}
 */
function readRunId(projectRoot) {
  try {
    const raw = readFileSync(join(projectRoot, '.pipeline', 'run-active.json'), 'utf8');
    const data = JSON.parse(raw);
    return (data && typeof data.runId === 'string') ? data.runId : null;
  } catch (_) {
    return null;
  }
}

/**
 * Detect anti-patterns in a list of JSONL entries.
 *
 * Entry shape (from ctx-post-tool.js):
 *   { tool_name, tool_input: { file_path?, ... }, agent_type, timestamp }
 *
 * @param {object[]} entries
 * @returns {{ pattern: string, detail: string, agentType: string }[]}
 */
function detectAntiPatterns(entries) {
  const findings = [];

  // State for repeated-reads and blind-write detection (per agent_type + file)
  // Maps: agentType -> Map<filePath, readCount>
  const readCounts = new Map();
  // Maps: agentType -> Set<filePath> (files ever Read by that agent)
  const readFiles = new Map();
  // Maps: agentType -> Set<filePath> (files Written/Edited by that agent before any Read)
  const writtenBeforeRead = new Map();

  // State for tool-storm detection (per agent_type + turn)
  // A "turn" is a contiguous block of tool calls with the same agent_type.
  // We use timestamp proximity (< 60 s gap) to group them, but primarily
  // we track them as one logical turn per agent_type because the JSONL
  // records all tools sequentially within a subagent run.
  //
  // Approach: group by agent_type, count all tool calls. If any agent emits
  // >20 tool calls total in the session, that is a tool-storm. This is
  // conservative but correct for the single-pass constraint.
  const toolCallCounts = new Map();

  // State for role-violation detection
  // conductor + Agent tool call to ad-hoc agent_type
  const conductorCheck = true; // we always check; skip if not conductor later

  for (const entry of entries) {
    const toolName = typeof entry.tool_name === 'string' ? entry.tool_name : '';
    const agentType = typeof entry.agent_type === 'string' ? entry.agent_type : 'orchestrator';
    const toolInput = (entry.tool_input && typeof entry.tool_input === 'object') ? entry.tool_input : {};
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';

    // -- tool-storm: count per-agent tool calls --
    const prevCount = toolCallCounts.get(agentType) || 0;
    toolCallCounts.set(agentType, prevCount + 1);

    // -- repeated-reads --
    if (toolName === 'Read' && filePath) {
      if (!readCounts.has(agentType)) readCounts.set(agentType, new Map());
      if (!readFiles.has(agentType)) readFiles.set(agentType, new Set());
      const agentReadCounts = readCounts.get(agentType);
      const count = (agentReadCounts.get(filePath) || 0) + 1;
      agentReadCounts.set(filePath, count);
      readFiles.get(agentType).add(filePath);
      if (count === 4) {
        // Trigger exactly at the 4th read (>3) to avoid duplicate findings
        findings.push({
          pattern: 'repeated-reads',
          detail: 'agent ' + agentType + ' read "' + filePath + '" ' + count + ' times',
          agentType,
        });
      }
    }

    // -- blind-write --
    if ((toolName === 'Write' || toolName === 'Edit') && filePath) {
      const agentReads = readFiles.get(agentType);
      const hasRead = agentReads ? agentReads.has(filePath) : false;
      if (!hasRead) {
        // Only record the first blind-write per agent+file to avoid duplicates
        if (!writtenBeforeRead.has(agentType)) writtenBeforeRead.set(agentType, new Set());
        const alreadyRecorded = writtenBeforeRead.get(agentType).has(filePath);
        if (!alreadyRecorded) {
          writtenBeforeRead.get(agentType).add(filePath);
          findings.push({
            pattern: 'blind-write',
            detail: 'agent ' + agentType + ' wrote "' + filePath + '" without prior Read',
            agentType,
          });
        }
      }
    }

    // -- role-violation: conductor using Agent for ad-hoc work --
    // The Agent tool call has tool_input.agent_type or tool_input.subagent_type
    if (toolName === 'Agent' && conductorCheck) {
      const invokingAgent = agentType; // the session role that called Agent
      // In conductor session, orchestrator should not use ad-hoc agents
      const subAgentType = typeof toolInput.agent_type === 'string'
        ? toolInput.agent_type
        : (typeof toolInput.subagent_type === 'string' ? toolInput.subagent_type : '');
      const normalizedSub = subAgentType.startsWith('forge:')
        ? subAgentType.slice('forge:'.length)
        : subAgentType;
      if (AD_HOC_AGENT_TYPES.has(normalizedSub.toLowerCase())) {
        findings.push({
          pattern: 'role-violation',
          detail: 'conductor session used Agent tool with ad-hoc type "' + subAgentType + '"',
          agentType: invokingAgent,
        });
      }
    }
  }

  // -- tool-storm: emit findings after full pass --
  for (const [agentType, count] of toolCallCounts.entries()) {
    if (count > 20) {
      findings.push({
        pattern: 'tool-storm',
        detail: 'agent ' + agentType + ' made ' + count + ' tool calls in a single session',
        agentType,
      });
    }
  }

  return findings;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.root) {
    process.stderr.write('[audit] --root <projectDir> is required\n');
    process.exit(0);
    return;
  }

  args.root = resolve(args.root);
  if (!args.root.startsWith(resolve('.'))) {
    process.stderr.write('[audit] --root must resolve within the current working directory\n');
    process.exit(0);
    return;
  }

  const sessionId = resolveSessionId(args.session);
  if (!sessionId) {
    // No session to audit — graceful no-op
    process.exit(0);
    return;
  }

  // Validate sessionId: only safe characters (same guard as ctx-post-tool.js)
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    process.stderr.write('[audit] session id contains unsafe characters — skipping\n');
    process.exit(0);
    return;
  }

  const auditPath = resolveAuditPath(sessionId);
  const entries = parseJsonl(auditPath);

  if (entries.length === 0) {
    // Empty or absent file — graceful no-op
    process.exit(0);
    return;
  }

  // Determine conductor/worker context for role-violation check
  const conductor = isConductorSession(args.root);
  // If this is a worker session, role-violation cannot apply
  const entriesToAudit = conductor ? entries : entries.filter(e => e.tool_name !== 'Agent');
  // When not conductor, still audit for other patterns on all entries
  const finalEntries = conductor ? entries : entries;

  const allFindings = detectAntiPatterns(finalEntries);

  // Filter role-violation findings to conductor sessions only
  const findings = conductor
    ? allFindings
    : allFindings.filter(f => f.pattern !== 'role-violation');

  if (findings.length === 0) {
    process.exit(0);
    return;
  }

  const runId = readRunId(args.root);
  const timestamp = new Date().toISOString();
  const auditLogPath = join(args.root, 'docs', 'audit-log.jsonl');

  const lines = findings.map(f => JSON.stringify({
    runId: runId || null,
    sessionId,
    agentType: f.agentType,
    pattern: f.pattern,
    detail: f.detail,
    timestamp,
  }));

  try {
    appendFileSync(auditLogPath, lines.join('\n') + '\n', 'utf8');
  } catch (err) {
    process.stderr.write('[audit] failed to write audit-log.jsonl: ' + err.message + '\n');
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write('[audit] unexpected error: ' + err.message + '\n');
  process.exit(0);
});
