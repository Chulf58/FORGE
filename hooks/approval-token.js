'use strict';

/**
 * UserPromptSubmit hook — git approval-token writer.
 *
 * Scans the user's message for git action keywords (commit, push). When found
 * (and not negated), writes a 120-second approval token to
 * .pipeline/action-approved.json. When not found, deletes any existing token
 * (clean slate per turn).
 *
 * This allows bash-guard.js to permit soft-blocked git commands (git commit,
 * git push) when the user has explicitly requested them in their last message.
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const STDIN_TIMEOUT_MS = 10_000;
const TOKEN_TTL_MS = 120_000; // 2 minutes

/** Actions and the keywords that trigger them. */
const ACTION_KEYWORDS = {
  commit: 'commit',
  push: 'push',
};

/**
 * Checks whether text in the ~40 characters before `index` contains a negation
 * word. Case-insensitive.
 */
function isNegated(text, index) {
  const NEGATIONS = ["don't", 'do not', 'no', 'stop', 'cancel', 'never', 'avoid'];
  const lookback = text.slice(Math.max(0, index - 40), index).toLowerCase();
  return NEGATIONS.some((neg) => lookback.includes(neg));
}

/**
 * Extracts a plain-text string from the UserPromptSubmit payload.
 * Tries multiple field shapes defensively.
 */
function extractUserMessage(payload) {
  if (!payload || typeof payload !== 'object') return '';

  // Shape 1: payload.message.content is a string
  if (payload.message && typeof payload.message.content === 'string') {
    return payload.message.content;
  }
  // Shape 2: payload.message.content is an array of blocks
  if (payload.message && Array.isArray(payload.message.content)) {
    return payload.message.content
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text || '')
      .join(' ');
  }
  // Shape 3: payload.message is a plain string
  if (typeof payload.message === 'string') {
    return payload.message;
  }
  // Shape 4: payload.user_prompt is a string
  if (typeof payload.user_prompt === 'string') {
    return payload.user_prompt;
  }
  return '';
}

/**
 * Scans the message for action keywords, respecting negation.
 * Returns an array of action strings that were detected (e.g. ["commit", "push"]).
 */
function detectActions(message) {
  const lower = message.toLowerCase();
  const detected = [];
  for (const [action, keyword] of Object.entries(ACTION_KEYWORDS)) {
    const safeKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\b' + safeKeyword + '\\b', 'gi');
    let m;
    while ((m = re.exec(lower)) !== null) {
      if (!isNegated(lower, m.index)) {
        detected.push(action);
        break; // one non-negated match per action is sufficient
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

  const projectDir = process.cwd();
  const tokenPath = path.join(projectDir, '.pipeline', 'action-approved.json');

  const message = extractUserMessage(payload);
  const actions = detectActions(message);

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
      fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2) + '\n', 'utf8');
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
