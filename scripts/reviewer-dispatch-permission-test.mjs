// @covers scripts/reviewer-dispatch.mjs
//
// 81b8f299 follow-up (end-to-end): a diff that changes the agent-dispatch permission /
// write-confinement boundary must route reviewer-safety + reviewer-logic — not just
// reviewer-tests. Exercises the classifier rule (lean-risk-classify) AND the
// RULE_TO_REVIEWERS mapping (reviewer-dispatch) via the real CLI. RED before both exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DIFF = `diff --git a/mcp/lib/orchestrator/agent-dispatch.mjs b/mcp/lib/orchestrator/agent-dispatch.mjs
--- a/mcp/lib/orchestrator/agent-dispatch.mjs
+++ b/mcp/lib/orchestrator/agent-dispatch.mjs
@@ -1,2 +1,4 @@
+      permissionMode: 'default',
+      canUseTool: async (toolName, input) => {
+        return { behavior: 'deny', message: 'x' };
`;

test('a permission/write-confinement diff routes reviewer-safety + reviewer-logic', () => {
  const diffFile = join(tmpdir(), `rd-perm-${process.pid}-${Date.now()}.txt`);
  const statusFile = join(tmpdir(), `rd-perm-status-${process.pid}-${Date.now()}.json`);
  try {
    writeFileSync(diffFile, DIFF, 'utf8');
    writeFileSync(statusFile, JSON.stringify({ verificationClean: true, hasBlockers: false }), 'utf8');
    const res = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'scripts', 'reviewer-dispatch.mjs'),
        `--diff=${diffFile}`,
        `--coder-status=${statusFile}`,
        '--stage=implement',
      ],
      { encoding: 'utf8', cwd: process.cwd() },
    );
    if (res.error) throw res.error;
    const out = JSON.parse(res.stdout);
    assert.ok(out.reviewers.includes('reviewer-safety'), 'must include reviewer-safety; got ' + JSON.stringify(out.reviewers));
    assert.ok(out.reviewers.includes('reviewer-logic'), 'must include reviewer-logic; got ' + JSON.stringify(out.reviewers));
  } finally {
    try { unlinkSync(diffFile); } catch (_) { /* ignore */ }
    try { unlinkSync(statusFile); } catch (_) { /* ignore */ }
  }
});
