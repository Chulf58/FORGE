'use strict';
// @covers hooks/audit-trigger.js
//
// Verifies the SubagentStop audit chain: hook → audit-tool-calls.mjs → docs/audit-log.jsonl.
//
// Red bar: detached spawn returns before the child writes (Windows race observed —
// audit-log.jsonl mtimes are stuck at 2026-05-05 despite hundreds of subagent stops since).
// Green bar after fix: synchronous execFileSync blocks the hook until the child completes.

const assert = require('assert');
const { spawnSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

const sessionId = 'audit-test-' + process.pid + '-' + Date.now();
const projectDir = mkdtempSync(join(tmpdir(), 'audit-trigger-test-'));
const tempJsonlPath = join(tmpdir(), 'claude-audit-' + sessionId + '.jsonl');
let failed = false;

try {
  // Seed: docs/ dir + a tool-call jsonl with a blind-write entry
  // (a Write tool call against a file never Read in the same session triggers
  // the blind-write anti-pattern in scripts/audit-tool-calls.mjs:170-186)
  mkdirSync(join(projectDir, 'docs'), { recursive: true });
  const entry = {
    tool_name: 'Write',
    tool_input: { file_path: '/some/file.ts' },
    agent_type: 'forge:coder',
    timestamp: new Date().toISOString(),
  };
  writeFileSync(tempJsonlPath, JSON.stringify(entry) + '\n');

  // Spawn the hook with the worktree project as cwd so audit-tool-calls.mjs's
  // root-guard (line 233-237 — `args.root must resolve within process.cwd()`)
  // passes the security check.
  const result = spawnSync(process.execPath, [join(__dirname, 'audit-trigger.js')], {
    cwd: projectDir,
    input: JSON.stringify({ session_id: sessionId, cwd: projectDir }),
    timeout: 10000,
    encoding: 'utf8',
  });

  if (result.error) {
    console.error('FAIL  hook spawn error: ' + result.error.message);
    failed = true;
  }

  // Assertion: docs/audit-log.jsonl exists with the blind-write finding by the
  // time the hook returned. The hook must NOT return before its child finished
  // writing — that's the whole point of the fix.
  const auditLogPath = join(projectDir, 'docs', 'audit-log.jsonl');
  if (!existsSync(auditLogPath)) {
    console.error('FAIL  audit-log.jsonl does not exist after hook returned (audit child did not finish in time)');
    if (result.stderr) console.error('      hook stderr: ' + result.stderr.trim());
    failed = true;
  } else {
    const content = readFileSync(auditLogPath, 'utf8');
    if (!content.includes('blind-write')) {
      console.error('FAIL  audit-log.jsonl exists but lacks blind-write finding');
      console.error('      content: ' + content.slice(0, 500));
      failed = true;
    } else if (!content.includes(sessionId)) {
      console.error('FAIL  audit-log.jsonl exists but does not reference the test sessionId');
      console.error('      content: ' + content.slice(0, 500));
      failed = true;
    } else {
      console.log('PASS  audit-trigger.js wrote blind-write finding synchronously');
    }
  }
} finally {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  try { rmSync(tempJsonlPath, { force: true }); } catch (_) {}
}

process.exit(failed ? 1 : 0);
