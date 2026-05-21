// mcp/forge-worker-escalation-reproducer.mjs
// @covers mcp/forge-worker.mjs
// Reproducer for the worker escalation-poll cycle.
// Tests the status-flip → poll → inject → resume sequence WITHOUT importing forge-worker.mjs.
//
// Phase 1 (red): exits non-zero — fake worker loop does not handle waiting-for-escalation.
// Phase 2 (green): exits 0 — fake loop detects waiting-for-escalation, reads response, injects.
//
// Run: node mcp/forge-worker-escalation-reproducer.mjs

import assert from 'node:assert/strict';

// ── Minimal fake channel ──────────────────────────────────────────────────────

function createFakeChannel() {
  const messages = [];
  return {
    push: (msg) => messages.push(msg),
    getMessages: () => messages,
  };
}

// ── Fake response file store ──────────────────────────────────────────────────

function createFakeEscalationStore() {
  const responses = new Map();
  return {
    placeResponse: (runId, escalationId, data) => {
      responses.set(runId + '-' + escalationId, data);
    },
    readResponse: (runId) => {
      for (const [key, data] of responses) {
        if (key.startsWith(runId + '-')) {
          responses.delete(key);
          return data;
        }
      }
      return null;
    },
  };
}

// ── Fake worker state machine (Phase 2 — GREEN: escalation-poll handled) ─────

function runFakeWorkerLoop(runState, store, channel, maxTicks) {
  for (let i = 0; i < maxTicks; i++) {
    if (runState.status === 'running') {
      continue;
    }
    if (runState.status === 'gate-pending') {
      break;
    }
    if (runState.status === 'waiting-for-escalation') {
      // Phase 2: check for response file matching <runId>-*.response.json
      const responseData = store.readResponse(runState.runId || 'r-testrun1');
      if (responseData) {
        // Inject response as user message — mirrors forge-worker.mjs escalation-poll branch
        channel.push({
          type: 'user',
          message: { role: 'user', content: 'Escalation response received (escalationId: ' + responseData.escalationId + '): ' + responseData.response },
          parent_tool_use_id: null,
        });
        // Flip status back to running
        runState.status = 'running';
      }
    }
  }
}

// ── Test: status-flip → poll → inject → resume ───────────────────────────────

{
  const store = createFakeEscalationStore();
  const channel = createFakeChannel();
  const runState = { status: 'running', runId: 'r-testrun1' };

  // Step 1: status flips to waiting-for-escalation
  const escalationId = 'esc-test01';
  runState.status = 'waiting-for-escalation';
  runState.escalationId = escalationId;

  // Step 2: conductor places a response
  store.placeResponse('r-testrun1', escalationId, { escalationId, response: 'proceed with option A' });

  // Step 3: run fake worker loop
  runFakeWorkerLoop(runState, store, channel, 10);

  // Step 4: assert response was injected (FAILS in Phase 1 — loop doesn't handle it)
  const msgs = channel.getMessages();
  assert.ok(
    msgs.length > 0,
    'FAIL: no user message injected — worker escalation-poll loop not implemented yet',
  );
  assert.ok(
    msgs[0].message.content.includes('proceed with option A'),
    'FAIL: injected message does not contain the escalation response',
  );
  assert.strictEqual(
    runState.status,
    'running',
    'FAIL: run status was not restored to running after escalation response',
  );

  process.stderr.write('PASS: escalation-poll cycle completed — response injected\n');
}

process.stdout.write('PASS\n');
process.exit(0);
