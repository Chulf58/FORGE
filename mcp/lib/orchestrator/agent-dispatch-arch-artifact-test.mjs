// @covers mcp/lib/orchestrator/agent-dispatch.mjs
// TDD red-bar: expectedArtifact must map 'implementation-architect' to 'docs/context/slice-brief.md'

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedArtifact } from './agent-dispatch.mjs';

test('expectedArtifact("implementation-architect") returns "docs/context/slice-brief.md"', () => {
  const result = expectedArtifact('implementation-architect');
  assert.strictEqual(
    result,
    'docs/context/slice-brief.md',
    'expectedArtifact("implementation-architect") must return "docs/context/slice-brief.md" so outcome classifies correctly',
  );
});
