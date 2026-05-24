// @covers scripts/forge-observer.mjs
// Content-removal tests: SPECS tab and its supporting code have been deleted
// (2026-05-18 — SPECS decommissioned per user feedback). Tests assert the
// negative — that no SPECS-related symbols remain in forge-observer.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'forge-observer.mjs'), 'utf8');

test('forge-observer no longer imports model-pricing.js', () => {
  assert.ok(
    !src.includes('model-pricing.js'),
    'forge-observer.mjs must not import the deleted scripts/lib/model-pricing.js',
  );
});

test('forge-observer no longer references the SPECS tab', () => {
  assert.ok(
    !src.includes("label: 'SPECS'"),
    'forge-observer.mjs must not register a SPECS tab',
  );
});

test('forge-observer no longer defines buildSpecsTab', () => {
  assert.ok(
    !src.includes('buildSpecsTab'),
    'buildSpecsTab and its switch case must be removed',
  );
});

test('forge-observer no longer reads classification.json', () => {
  assert.ok(
    !src.includes('classification.json'),
    'classification.json reads were SPECS-only and must be removed',
  );
});

test('forge-observer no longer defines loadAgentHealth', () => {
  assert.ok(
    !src.includes('loadAgentHealth'),
    'loadAgentHealth was SPECS-only and must be removed',
  );
});

test("forge-observer no longer binds the '4' key to a SPECS tab switch", () => {
  assert.ok(
    !src.includes("case '4': switchTab(3)"),
    "keypress handler must not route '4' to a removed tab index",
  );
});

// ── Task 4: latestBlock red-marker wiring ────────────────────────────────────
// Red bar until forge-observer.mjs pushes a 'Block' row and colors it red.

test("forge-observer pushes a Block row to detailRows when latestBlock is present", () => {
  assert.ok(
    src.includes("'Block'") && src.includes('latestBlock'),
    "forge-observer.mjs must push a 'Block' row to detailRows when merged.latestBlock is non-null",
  );
});

test("forge-observer applies red ANSI color to the Block detail row value", () => {
  assert.ok(
    src.includes("label === 'Block' ? 'red'") || src.includes('label===\'Block\'?\'red\''),
    "forge-observer.mjs valColor logic must map label 'Block' to 'red'",
  );
});

// ── Task 8: waiting-for-escalation badge + [response-needed] rendering ────────
// Red bar until forge-observer.mjs handles waiting-for-escalation status and
// renders the [response-needed] badge with forge_respond_to_escalation hint.

test("forge-observer statusOf handles waiting-for-escalation status", () => {
  assert.ok(
    src.includes("waiting-for-escalation"),
    "forge-observer.mjs statusOf() must handle run.status === 'waiting-for-escalation'",
  );
});

test("forge-observer renders [response-needed] badge for responseRequested escalations", () => {
  assert.ok(
    src.includes("response-needed"),
    "forge-observer.mjs must render a '[response-needed]' badge in detailRows when escalation has responseRequested: true",
  );
});

test("forge-observer shows forge_respond_to_escalation hint for response-needed escalations", () => {
  assert.ok(
    src.includes("forge_respond_to_escalation"),
    "forge-observer.mjs must include 'forge_respond_to_escalation' in the hint line for responseRequested escalations",
  );
});

// ── AC-5: loop-guard-pending yellow card rendering ───────────────────────────
// Red bar until forge-observer.mjs handles loop-guard-pending status.

test("forge-observer statusOf maps loop-guard-pending to yellow dot ⏸", () => {
  assert.ok(
    src.includes("loop-guard-pending") && src.includes("dot: '⏸'"),
    "forge-observer.mjs statusOf() must map status 'loop-guard-pending' to { dot: '⏸', color: 'yellow' }",
  );
});

test("forge-observer animIcon uses ANIM.gate for loop-guard-pending", () => {
  assert.ok(
    src.includes("loop-guard-pending") && src.includes("ANIM.gate"),
    "forge-observer.mjs animIcon() must use ANIM.gate frames for loop-guard-pending status",
  );
});

test("forge-observer detail rows show Loop-guard label for loop-guard-pending", () => {
  assert.ok(
    src.includes("'Loop-guard'"),
    "forge-observer.mjs must push a 'Loop-guard' detail row for loop-guard-pending runs",
  );
});

test("forge-observer detail row includes /forge:unblock hint", () => {
  assert.ok(
    src.includes("/forge:unblock"),
    "forge-observer.mjs detail row must include '/forge:unblock <runId>' hint",
  );
});

test("forge-observer active/gates filter includes loop-guard-pending in gates bucket", () => {
  assert.ok(
    src.includes("loop-guard-pending") &&
    (src.includes("r.status === 'loop-guard-pending'") || src.includes("r.status==='loop-guard-pending'")),
    "forge-observer.mjs gates filter must include loop-guard-pending alongside gate-pending",
  );
});

// Regression: gate-pending rendering still present (no cross-contamination)
test("forge-observer gate-pending rendering still present (regression)", () => {
  assert.ok(
    src.includes("gate-pending"),
    "forge-observer.mjs must still handle gate-pending status (regression guard)",
  );
});

test("forge-observer runProgress handles loop-guard-pending case", () => {
  assert.ok(
    src.includes("loop-guard-pending") && src.includes("loop-guard"),
    "forge-observer.mjs runProgress() must handle loop-guard-pending with a progress bar + label",
  );
});

// Preflight must use the bundled npm-cli.js pattern (makeNpmRunner from
// scripts/lib/preflight.cjs) — not execSync('npm ...'). The observer's
// standalone launch path runs outside the SessionStart hook lifecycle, so
// bare `npm` may not be on PATH. Brainstorm constraint for observer-preflight.
test("forge-observer preflight uses makeNpmRunner, not execSync(['npm']...)", () => {
  assert.ok(
    src.includes("makeNpmRunner()"),
    "forge-observer preflight must call makeNpmRunner() from preflight.cjs",
  );
  assert.ok(
    !src.includes("execSync(['npm']"),
    "forge-observer preflight must not use execSync(['npm']...) — bare npm requires PATH",
  );
});

