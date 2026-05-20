// @covers hooks/agent-loop-guard.js — EXEMPT_AGENTS set membership
// Task 1: researcher must appear in EXEMPT_AGENTS.
// This test is red until agent-loop-guard.js is updated to include 'researcher'.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'agent-loop-guard.js'), 'utf8');

test("'researcher' is in EXEMPT_AGENTS", () => {
  assert.ok(
    src.includes("'researcher'"),
    "agent-loop-guard.js must include 'researcher' in EXEMPT_AGENTS — without this exemption the needs-researcher signal contract is useless after two passes",
  );
});
