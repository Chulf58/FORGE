// @covers scripts/lean-risk-classify.mjs
//
// 81b8f299 follow-up: the deterministic reviewer-dispatch UNDER-classified the canUseTool
// write-confinement fix — a permission/dispatch-security source change matched no risk rule,
// so only reviewer-tests fired (no reviewer-safety/reviewer-logic). A change touching the
// agent dispatch permission boundary (permissionMode / canUseTool / bypassPermissions /
// allowDangerouslySkipPermissions) MUST trigger a risk rule. RED before the rule exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDiff } from './lean-risk-classify.mjs';

const DIFF = `diff --git a/mcp/lib/orchestrator/agent-dispatch.mjs b/mcp/lib/orchestrator/agent-dispatch.mjs
--- a/mcp/lib/orchestrator/agent-dispatch.mjs
+++ b/mcp/lib/orchestrator/agent-dispatch.mjs
@@ -1,2 +1,4 @@
+      permissionMode: 'default',
+      canUseTool: async (toolName, input) => {
+        return { behavior: 'deny', message: 'outside worktree' };
`;

test('classifyDiff flags a permission/write-confinement change (agent-dispatch-permission)', () => {
  const r = classifyDiff({ diffContent: DIFF, coderStatus: { verificationClean: true, hasBlockers: false } });
  const rules = (r.triggeredRules || []).map((x) => (typeof x === 'string' ? x.split(':')[0] : x.rule));
  assert.ok(
    rules.includes('agent-dispatch-permission'),
    'permissionMode/canUseTool change must trigger agent-dispatch-permission; got ' + JSON.stringify(rules),
  );
});
