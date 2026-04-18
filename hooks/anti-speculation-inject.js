'use strict';

/**
 * UserPromptSubmit hook — anti-speculation rule injector.
 *
 * WHY THIS EXISTS:
 * The main conversational Claude has repeatedly asserted unverified claims about
 * codebase state ("X was wound down", "Y uses sonnet") without reading the relevant
 * file first. No output-filter hook exists in Claude Code — hooks cannot intercept
 * assistant message text. The strongest available structural lever is UserPromptSubmit,
 * which fires before each assistant response and can inject additionalContext silently
 * (UserPromptSubmit is on the validator's hookSpecificOutput allow-list, confirmed
 * 2026-04 — see docs/gotchas/GENERAL.md PostCompact section). This keeps the rule
 * top-of-context even after CLAUDE.md degrades during long sessions.
 *
 * The stdin payload (user prompt + meta) is read but not inspected — this hook fires
 * unconditionally on every user turn.
 */

const readline = require('readline');

const STDIN_TIMEOUT_MS = 10_000;

const ANTI_SPECULATION_RULE =
  'FORGE anti-speculation rule (always applies):\n' +
  'Before stating anything about this codebase\'s state, history, what exists, or what happened — ' +
  'cite file:line from a Read/Grep you called THIS turn, or answer "I don\'t know, checking." ' +
  'and call the tool. No "appears to", "likely", "probably", "I assume", "seems to have been", ' +
  '"I think it was". If you don\'t have evidence in this turn\'s tool calls, you don\'t know — ' +
  'say so and check.';

async function main(rawInput) {
  // Parse stdin to satisfy the hook contract; no fields are inspected.
  // If the payload is malformed, we still inject — the rule is unconditional.
  try { JSON.parse(rawInput); } catch (_) { /* best-effort; continue */ }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: ANTI_SPECULATION_RULE,
    },
  }) + '\n');

  process.exit(0);
}

// Read stdin with timeout guard — mirrors ctx-session-start.js pattern.
let inputData = '';
const timer = setTimeout(() => {
  main(inputData || '{}').catch(() => process.exit(0));
}, STDIN_TIMEOUT_MS);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => { inputData += line + '\n'; });
rl.on('close', () => {
  clearTimeout(timer);
  main(inputData || '{}').catch(() => process.exit(0));
});
