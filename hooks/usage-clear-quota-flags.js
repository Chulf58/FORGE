'use strict';

// SessionStart hook: clear all quotaExhausted flags in .pipeline/usage.json.
//
// WHY THIS EXISTS:
// usage-store.js writes quotaExhausted: true persistently and never auto-clears it.
// resetAt is always null and is never consulted by the router. The result is that a
// single 429 or billing error in one session permanently poisons the affected provider
// (and every sibling model, because isModelQuotaExhausted propagates a provider-level
// flag to all models under it) across all future sessions.
//
// This hook session-scopes exhaustion: flags are cleared at session start so every new
// Claude Code session begins with a clean routing slate. Token/request counters and all
// other fields are preserved exactly. resetAt is left in place unchanged.
//
// Errors are swallowed — a broken hook must never block session start.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { STDIN_TIMEOUT_LONG } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_LONG;
const USAGE_RELATIVE_PATH = path.join('.pipeline', 'usage.json');

function clearQuotaFlags(projectDir) {
  const usagePath = path.join(projectDir, USAGE_RELATIVE_PATH);
  try {
    if (!fs.existsSync(usagePath)) {
      // No usage file yet — nothing to clear.
      return;
    }
    const raw = fs.readFileSync(usagePath, 'utf8');
    const usage = JSON.parse(raw);

    let mutated = false;

    if (usage.providers && typeof usage.providers === 'object') {
      for (const providerId of Object.keys(usage.providers)) {
        const provider = usage.providers[providerId];
        if (provider && typeof provider === 'object') {
          if (provider.quotaExhausted === true) {
            provider.quotaExhausted = false;
            mutated = true;
          }
          if (provider.models && typeof provider.models === 'object') {
            for (const modelId of Object.keys(provider.models)) {
              const model = provider.models[modelId];
              if (model && typeof model === 'object' && model.quotaExhausted === true) {
                model.quotaExhausted = false;
                mutated = true;
              }
            }
          }
        }
      }
    }

    // Only write if something actually changed — preserves updatedAt on no-op sessions.
    if (mutated) {
      usage.updatedAt = new Date().toISOString();
      fs.writeFileSync(usagePath, JSON.stringify(usage, null, 2) + '\n', 'utf8');
    }
  } catch (_) {
    // Best-effort: usage.json is not critical for session start.
    // A missing or corrupt file is acceptable — the MCP router handles that case.
  }
}

async function main(_rawInput) {
  // Payload ignored — only process.cwd() is needed as the project root.
  clearQuotaFlags(process.cwd());
  process.exit(0);
}

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
