'use strict';

/**
 * UserPromptSubmit hook — git approval-token writer.
 *
 * Scans the user's message for git action keywords (commit, push). When found
 * (and not negated), writes a 5-minute approval token to
 * .pipeline/action-approved.json. When not found, deletes any existing token
 * (clean slate per turn).
 *
 * This allows bash-guard.js to permit soft-blocked git commands (git commit,
 * git push) when the user has explicitly requested them in their last message.
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { STDIN_TIMEOUT_LONG, resolveProjectDir } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_LONG;
const TOKEN_TTL_MS = 1_800_000; // 30 minutes

/** Actions and the keywords that trigger them.
 *
 * gate-approve fires ONLY on the literal word "approve" — broader natural-
 * language keywords (go/yes/lgtm/etc.) are intentionally rejected. The friction
 * of typing "approve" is by design: it forces a deliberate, unambiguous
 * decision rather than picking up casual conversation tokens.
 */
const ACTION_KEYWORDS = {
  commit: 'commit',
  push: 'push',
  'gate-approve': 'approve',
};

/** Negation regexes — hoisted to module scope (compiled once per process).
 *
 * Single-word tokens (`no`, `stop`, `cancel`, `never`, `avoid`) use `\b<word>\b`
 * so substrings like `note`, `none`, `diagnose`, `north` no longer falsely
 * match `no`. Apostrophe token `don't` uses `\bdon't\b` (the apostrophe sits
 * between word characters, so `\b` correctly anchors at `d` and `t`). The
 * multi-word phrase `do not` uses `\bdo\s+not\b` to allow multiple whitespace
 * characters between the words.
 */
const NEGATION_REGEXES = [
  /\bno\b/i,
  /\bstop\b/i,
  /\bcancel\b/i,
  /\bnever\b/i,
  /\bavoid\b/i,
  /\bdon't\b/i,
  /\bdo\s+not\b/i,
];

/**
 * Checks whether text in the ~80 characters before `index` contains a negation
 * word. Case-insensitive, word-boundary anchored.
 *
 * 80 chars covers sentence-initial negations followed by a qualifying clause
 * (e.g. "No, under no particular circumstances would you want to push").
 * 40 chars was too short for these patterns.
 */
function isNegated(text, index) {
  const lookback = text.slice(Math.max(0, index - 80), index);
  return NEGATION_REGEXES.some((re) => re.test(lookback));
}

/**
 * Strips Claude Code injected `<system-reminder>...</system-reminder>` blocks
 * from a string. Non-greedy, case-insensitive, multi-block.
 *
 * Claude Code injects system-reminder context (FORGE conductor rules,
 * anti-speculation rule, etc.) into the prompt string. These blocks contain
 * words like `approve`, `commit`, `push`, `no`, `never`, `don't` that would
 * otherwise trigger false-positive token writes or false negation suppression.
 *
 * Unclosed/truncated `<system-reminder>` tags (no closing tag) are LEFT IN —
 * the regex requires a matching closer. Greedy matching across truncations
 * risks gutting legitimate user text.
 */
function stripInjectedContext(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '');
}

/**
 * Extracts a plain-text string from the UserPromptSubmit payload, with
 * Claude Code injected `<system-reminder>` context stripped.
 *
 * Claude Code sends { prompt: "user text", session_id, cwd, ... } on stdin.
 * The canonical field is `payload.prompt` (plain string). Legacy/test shapes
 * are kept as defensive fallbacks. All shapes pass through `stripInjectedContext`
 * before returning so keyword detection runs only against user-typed text.
 */
function extractUserMessage(payload) {
  if (!payload || typeof payload !== 'object') return '';

  let raw = '';
  // Canonical shape: payload.prompt is a plain string (Claude Code documented contract)
  if (typeof payload.prompt === 'string') {
    raw = payload.prompt;
  }
  // Fallback 1: payload.message.content is a string
  else if (payload.message && typeof payload.message.content === 'string') {
    raw = payload.message.content;
  }
  // Fallback 2: payload.message.content is an array of blocks
  else if (payload.message && Array.isArray(payload.message.content)) {
    raw = payload.message.content
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text || '')
      .join(' ');
  }
  // Fallback 3: payload.message is a plain string
  else if (typeof payload.message === 'string') {
    raw = payload.message;
  }
  // Fallback 4: payload.user_prompt is a string
  else if (typeof payload.user_prompt === 'string') {
    raw = payload.user_prompt;
  }

  return stripInjectedContext(raw);
}

/**
 * Scans the message for action keywords, respecting negation.
 * Returns an array of action strings that were detected (e.g. ["commit", "push"]).
 *
 * ACTION_KEYWORDS values may be a string (single keyword) or an array of
 * keywords/phrases. Single-word entries use \b word-boundary matching;
 * multi-word phrases (containing a space) use plain substring matching so
 * punctuation adjacent to the phrase does not cause false negatives.
 */
function detectActions(message) {
  const lower = message.toLowerCase();
  const detected = [];
  for (const [action, keywords] of Object.entries(ACTION_KEYWORDS)) {
    const list = Array.isArray(keywords) ? keywords : [keywords];
    let found = false;
    for (const kw of list) {
      if (found) break;
      const safeKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isPhrase = kw.includes(' ');
      // Multi-word phrases: substring match (no word-boundary anchors)
      // Single words: word-boundary anchored match
      const pattern = isPhrase ? safeKw : '\\b' + safeKw + '\\b';
      const re = new RegExp(pattern, 'gi');
      let m;
      while ((m = re.exec(lower)) !== null) {
        if (!isNegated(lower, m.index)) {
          detected.push(action);
          found = true;
          break; // one non-negated match per action is sufficient
        }
      }
    }
  }
  return detected;
}

async function main(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    // Malformed stdin — exit cleanly, no token written or deleted
    process.exit(0);
    return;
  }

  const projectDir = resolveProjectDir(payload);
  const tokenPath = path.join(projectDir, '.pipeline', 'action-approved.json');

  const message = extractUserMessage(payload);
  const actions = detectActions(message);

  // When approving a commit gate, auto-include the "commit" action so one
  // "approve" message unlocks both gate approval and the git commit.
  if (actions.includes('gate-approve') && !actions.includes('commit')) {
    try {
      const gatePath = path.join(projectDir, '.pipeline', 'gate-pending.json');
      const gateData = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
      if (gateData && gateData.gate === 'commit') {
        actions.push('commit');
      }
    } catch (_) {
      // No gate file or not a commit gate — no action needed
    }
  }

  if (actions.length > 0) {
    // Write approval token with TTL
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
    const token = {
      actions,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      source: 'user-prompt',
    };

    try {
      // Ensure .pipeline/ exists before writing (normally it does, but be safe)
      const pipelineDir = path.join(projectDir, '.pipeline');
      if (!fs.existsSync(pipelineDir)) {
        fs.mkdirSync(pipelineDir, { recursive: true });
      }
      const tmpPath = tokenPath + '.tmp.' + process.pid;
      fs.writeFileSync(tmpPath, JSON.stringify(token, null, 2) + '\n', 'utf8');
      fs.renameSync(tmpPath, tokenPath);
    } catch (_) {
      // Non-fatal: if we can't write the token, git commands will simply be blocked
    }
  } else {
    // No action keywords detected — delete any existing token (clean slate)
    try {
      if (fs.existsSync(tokenPath)) {
        fs.unlinkSync(tokenPath);
      }
    } catch (_) {
      // Non-fatal: stale token will simply be rejected when it expires
    }
  }

  process.exit(0);
}

// Read stdin with timeout guard
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
