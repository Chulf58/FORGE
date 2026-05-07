import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Load constants and pure functions by extracting them from approval-token.js
// source (which is CommonJS). Strip the runtime-only sections (require statements,
// main(), readline setup) so the remaining code can be evaluated in isolation.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, 'approval-token.js'), 'utf8');

const isolatedSrc = src
  .replace(/^'use strict';\n/, '')
  .replace(/^const readline.*$/m, '// readline removed')
  .replace(/^const fs.*$/m, '// fs removed')
  .replace(/^const path.*$/m, '// path removed')
  .replace(/^const \{ STDIN_TIMEOUT_LONG.*$/m, '// hook-utils removed')
  .replace(/^const STDIN_TIMEOUT_MS.*$/m, '// STDIN_TIMEOUT_MS removed')
  .replace(/^const TOKEN_TTL_MS.*$/m, '// TOKEN_TTL_MS removed')
  .replace(/^async function main[\s\S]*?\n^}/m, '// main removed')
  .replace(/^\/\/ Read stdin[\s\S]*/m, '// readline setup removed');

const mod = {};
const fn = new Function(
  'module',
  'exports',
  isolatedSrc +
    '\nmodule.exports = { detectActions, isNegated, stripInjectedContext, extractUserMessage, ACTION_KEYWORDS, NEGATION_REGEXES };'
);
fn(mod, mod);
const { detectActions, isNegated, stripInjectedContext, extractUserMessage, ACTION_KEYWORDS, NEGATION_REGEXES } = mod.exports;

// ─── ACTION_KEYWORDS shape ───────────────────────────────────────────

test('ACTION_KEYWORDS gate-approve is the literal string "approve"', () => {
  assert.equal(
    ACTION_KEYWORDS['gate-approve'],
    'approve',
    'gate-approve must be the single string "approve" — broader natural-language keywords are intentionally rejected'
  );
});

test('ACTION_KEYWORDS commit and push remain string-valued', () => {
  assert.equal(typeof ACTION_KEYWORDS.commit, 'string');
  assert.equal(typeof ACTION_KEYWORDS.push, 'string');
});

test('NEGATION_REGEXES is hoisted at module scope (compiled once)', () => {
  assert.ok(Array.isArray(NEGATION_REGEXES));
  assert.equal(NEGATION_REGEXES.length, 7);
  for (const re of NEGATION_REGEXES) {
    assert.ok(re instanceof RegExp);
    assert.ok(re.flags.includes('i'));
  }
});

// ─── detectActions: positive paths ───────────────────────────────────

test('detectActions: literal "approve" fires gate-approve', () => {
  assert.deepEqual(detectActions('please approve this'), ['gate-approve']);
});

test('detectActions: commit fires for string keyword', () => {
  assert.ok(detectActions('please commit').includes('commit'));
});

test('detectActions: push fires for string keyword', () => {
  assert.ok(detectActions('push the branch').includes('push'));
});

// ─── detectActions: negation suppression (genuine user negations) ────

test("detectActions: \"don't approve\" suppresses gate-approve", () => {
  assert.deepEqual(detectActions("don't approve this"), []);
});

test("detectActions: \"don't commit\" suppresses commit", () => {
  assert.deepEqual(detectActions("don't commit yet"), []);
});

test('detectActions: "do not push" suppresses push', () => {
  assert.deepEqual(detectActions('do not push to main'), []);
});

test('detectActions: "do  not push" (double space) suppresses push', () => {
  assert.deepEqual(detectActions('do  not push to main'), []);
});

test("detectActions: \"no, don't commit\" suppresses commit", () => {
  assert.deepEqual(detectActions("no, don't commit"), []);
});

test('detectActions: standalone "no" still suppresses', () => {
  assert.deepEqual(detectActions('no, commit'), []);
});

test('detectActions: standalone "never" still suppresses', () => {
  assert.deepEqual(detectActions('never push to prod'), []);
});

// ─── AC-2: word-boundary negation (no substring false-suppression) ──

test('detectActions: "no" inside "note" does NOT suppress following commit', () => {
  // Old behavior: lookback.includes("no") matched inside "note" and suppressed commit.
  // New behavior: \bno\b only matches the standalone word.
  assert.deepEqual(detectActions('please note: commit'), ['commit']);
});

test('detectActions: "no" inside "none" does NOT suppress following commit', () => {
  assert.deepEqual(detectActions('none of these issues — commit'), ['commit']);
});

test('detectActions: "no" inside "diagnose" does NOT suppress following push', () => {
  assert.deepEqual(detectActions('diagnose then push'), ['push']);
});

test('detectActions: "no" inside "north" does NOT suppress following commit', () => {
  assert.deepEqual(detectActions('go north then commit'), ['commit']);
});

// ─── AC-1: stripInjectedContext direct unit tests ───────────────────

test('stripInjectedContext: removes a single system-reminder block', () => {
  const input = 'before <system-reminder>injected text</system-reminder> after';
  assert.equal(stripInjectedContext(input), 'before  after');
});

test('stripInjectedContext: removes multiple non-overlapping blocks', () => {
  const input = '<system-reminder>one</system-reminder> mid <system-reminder>two</system-reminder> end';
  assert.equal(stripInjectedContext(input), ' mid  end');
});

test('stripInjectedContext: handles CRLF inside a block', () => {
  const input = 'a <system-reminder>line1\r\nline2\r\n</system-reminder> b';
  assert.equal(stripInjectedContext(input), 'a  b');
});

test('stripInjectedContext: handles LF inside a block', () => {
  const input = 'a <system-reminder>line1\nline2\n</system-reminder> b';
  assert.equal(stripInjectedContext(input), 'a  b');
});

test('stripInjectedContext: leaves unclosed system-reminder tag untouched', () => {
  const input = 'before <system-reminder>truncated';
  assert.equal(stripInjectedContext(input), 'before <system-reminder>truncated');
});

test('stripInjectedContext: case-insensitive tag matching', () => {
  const input = 'a <SYSTEM-REMINDER>x</SYSTEM-REMINDER> b';
  assert.equal(stripInjectedContext(input), 'a  b');
});

test('stripInjectedContext: returns non-string inputs unchanged', () => {
  assert.equal(stripInjectedContext(null), null);
  assert.equal(stripInjectedContext(undefined), undefined);
  assert.equal(stripInjectedContext(123), 123);
});

// ─── AC-1 integration: system-reminder context cannot trigger detection ─

test('detectActions: "approve" inside <system-reminder> does NOT detect (after strip)', () => {
  const message = extractUserMessage({ prompt: '<system-reminder>type approve to confirm</system-reminder>' });
  assert.deepEqual(detectActions(message), []);
});

test('detectActions: two system-reminder blocks each with keywords are both stripped', () => {
  const message = extractUserMessage({
    prompt: '<system-reminder>commit</system-reminder> middle <system-reminder>approve</system-reminder>',
  });
  assert.deepEqual(detectActions(message), []);
});

test('detectActions: keyword OUTSIDE system-reminder still detects (with system-reminder also present)', () => {
  const message = extractUserMessage({ prompt: '<system-reminder>foo</system-reminder> please commit' });
  assert.ok(detectActions(message).includes('commit'));
});

test('detectActions: literal "approve" with FORGE conductor rule injection still fires', () => {
  // Realistic shape: user typed "approve" but multiple system-reminder blocks
  // contain words like "no", "never", "don't" that would have falsely suppressed
  // it under the old isNegated lookback + no stripping.
  const fullPrompt = [
    '<system-reminder>FORGE conductor rule: never approve over a BLOCK.</system-reminder>',
    '<system-reminder>Anti-speculation: Do NOT use the Agent tool.</system-reminder>',
    'approve',
  ].join('\n');
  const message = extractUserMessage({ prompt: fullPrompt });
  assert.deepEqual(
    detectActions(message),
    ['gate-approve'],
    'literal "approve" must fire even when system-reminder blocks contain negation words'
  );
});

// ─── extractUserMessage fallback shapes still work + are stripped ───

test('extractUserMessage: payload.message.content as string', () => {
  const result = extractUserMessage({ message: { content: 'hello <system-reminder>x</system-reminder>' } });
  assert.equal(result, 'hello ');
});

test('extractUserMessage: payload.message.content as array of text blocks', () => {
  const result = extractUserMessage({
    message: {
      content: [
        { type: 'text', text: 'a <system-reminder>x</system-reminder>' },
        { type: 'text', text: ' b' },
      ],
    },
  });
  assert.equal(result, 'a   b');
});

test('extractUserMessage: payload.user_prompt fallback', () => {
  const result = extractUserMessage({ user_prompt: 'commit <system-reminder>x</system-reminder>' });
  assert.equal(result, 'commit ');
});

test('extractUserMessage: returns empty string for invalid payloads', () => {
  assert.equal(extractUserMessage(null), '');
  assert.equal(extractUserMessage(undefined), '');
  assert.equal(extractUserMessage('string-not-object'), '');
  assert.equal(extractUserMessage({}), '');
});
