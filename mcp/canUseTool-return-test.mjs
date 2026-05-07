#!/usr/bin/env node
// Validates that canUseTool return shapes match the SDK's runtime Zod schema.
// The SDK validates PermissionResult as a discriminated union:
//   { updatedInput: Record<string,unknown>, ... } | { behavior: 'deny', message: string, ... }
//
// Run: node mcp/canUseTool-return-test.mjs

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { z } = require('zod');

// Reconstruct the PermissionResult schema from the ZodError we observed.
// The union has two branches:
//   1. { updatedInput: record } (allow)
//   2. { behavior: literal('deny'), message: string } (deny)
const AllowBranch = z.object({
  updatedInput: z.record(z.unknown()),
}).passthrough();

const DenyBranch = z.object({
  behavior: z.literal('deny'),
  message: z.string(),
}).passthrough();

const PermissionResult = z.union([AllowBranch, DenyBranch]);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log('  PASS  ' + label); passed++; }
  else { console.error('  FAIL  ' + label); failed++; }
}

console.log('\n── canUseTool-return-test.mjs ───────────────────────────────────────────');

// Allow shapes (what forge-worker.mjs returns)
assert(
  PermissionResult.safeParse({ updatedInput: {} }).success,
  '{ updatedInput: {} } is valid allow'
);

assert(
  PermissionResult.safeParse({ updatedInput: {}, behavior: 'allow' }).success,
  '{ updatedInput: {}, behavior: "allow" } is valid allow'
);

// Deny shapes
assert(
  PermissionResult.safeParse({ behavior: 'deny', message: 'not allowed' }).success,
  '{ behavior: "deny", message: "..." } is valid deny'
);

// INVALID shapes (what broke before)
assert(
  !PermissionResult.safeParse({ behavior: 'allow' }).success,
  '{ behavior: "allow" } WITHOUT updatedInput is INVALID (the bug)'
);

assert(
  !PermissionResult.safeParse({}).success,
  'empty object is INVALID'
);

assert(
  !PermissionResult.safeParse({ behavior: 'deny' }).success,
  '{ behavior: "deny" } without message is INVALID'
);

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
