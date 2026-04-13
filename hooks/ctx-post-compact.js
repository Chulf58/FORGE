'use strict';

// PostCompact hook — intentionally silent.
//
// Real-runtime evidence (Claude Code, 2026-04): every PostCompact stdout
// shape — bare text, top-level `systemMessage + suppressOutput`, top-level
// `additionalContext + suppressOutput`, and the `hookSpecificOutput` envelope
// (which the validator rejects outright) — is echoed verbatim into the
// `/compact` completion line. There is no supported path here that both
// injects context AND stays out of the visible chrome.
//
// Rather than dump rules text into the user's view on every compaction, this
// hook now no-ops. CLAUDE.md and forge-rules.md remain on disk; Claude can
// re-read them when needed.
//
// Future silent-reinjection work should migrate to a PreCompact-writes-marker
// + UserPromptSubmit-injects-then-deletes pattern (UserPromptSubmit is on the
// validator's hookSpecificOutput allow-list, so silent injection is viable).
// This file is preserved so the hooks.json registration keeps working until
// that migration lands.

const readline = require('readline');

const STDIN_TIMEOUT_MS = 10000;

function exitSilent() {
  process.exit(0);
}

// -- Stdin reader with timeout guard -----------------------------------------
let inputData = '';
const timer = setTimeout(exitSilent, STDIN_TIMEOUT_MS);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => { inputData += line + '\n'; });
rl.on('close', () => {
  clearTimeout(timer);
  // Consume stdin per protocol; payload is not used.
  try { JSON.parse(inputData || '{}'); } catch (_) { /* ignore */ }
  exitSilent();
});
