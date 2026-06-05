// @covers mcp/lib/orchestrator/agent-dispatch.mjs
//
// buildQueryParams worktree write-confinement (81b8f299). The dispatch must run in a
// permission mode that INVOKES a canUseTool callback — a first-class query() option that
// fires even when plugin PreToolUse hooks do NOT for query() dispatches (proven by the
// dispatch smoke test: workflow-guard.js never engaged). That callback must DENY a
// Write/Edit resolving OUTSIDE workDir while ALLOWING in-worktree writes and all other
// tools (so no r-15662c22 "agent wrote nothing" re-block). Bash is allowed here — the
// callback can't reliably parse Bash write targets (documented gap).
//
// RED pre-fix (permissionMode:'bypassPermissions', no canUseTool); GREEN post-fix.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildQueryParams } from './agent-dispatch.mjs';

function params(workDir) {
  return buildQueryParams({
    prompt: 'x',
    agentModel: 'claude-haiku-4-5-20251001',
    agentBody: 'body',
    workDir,
    pluginRoot: '/plugin',
    buildMcpServer: () => ({}),
  });
}

const WT = '/main/.worktrees/r-x';

test('buildQueryParams uses a non-bypass permission mode with a canUseTool callback', () => {
  const { options } = params(WT);
  assert.notEqual(options.permissionMode, 'bypassPermissions',
    'must NOT use bypassPermissions (it disables write-confinement); got ' + options.permissionMode);
  assert.equal(typeof options.canUseTool, 'function',
    'must wire a canUseTool callback (the only confinement that fires for query() dispatches)');
});

test('canUseTool DENIES a Write resolving outside the worktree', async () => {
  const { options } = params(WT);
  const res = await options.canUseTool('Write', { file_path: '/main/scripts/leak-test.mjs' }, {});
  assert.equal(res.behavior, 'deny', 'out-of-worktree Write must be denied; got ' + JSON.stringify(res));
});

test('canUseTool ALLOWS an in-worktree Write', async () => {
  const { options } = params(WT);
  const res = await options.canUseTool('Write', { file_path: '/main/.worktrees/r-x/scripts/ok-test.mjs' }, {});
  assert.equal(res.behavior, 'allow', 'in-worktree Write must be allowed; got ' + JSON.stringify(res));
});

test('canUseTool ALLOWS non-Write tools (Read/Bash) unconditionally', async () => {
  const { options } = params(WT);
  const r1 = await options.canUseTool('Read', { file_path: '/anywhere/x' }, {});
  const r2 = await options.canUseTool('Bash', { command: 'node -e ""' }, {});
  assert.equal(r1.behavior, 'allow', 'Read must be allowed anywhere; got ' + JSON.stringify(r1));
  assert.equal(r2.behavior, 'allow', 'Bash must be allowed (path-confinement gap documented); got ' + JSON.stringify(r2));
});
