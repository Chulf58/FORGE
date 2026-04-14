'use strict';

// forge-banner.js — SessionStart hook
// Reads forge-banner.txt and emits it directly via hookSpecificOutput
// additionalContext on SessionStart. The banner appears on the first model
// response of a fresh session without depending on any tool call.
//
// Previous design used a pending-flag file that ctx-post-tool.js picked up
// on the first PostToolUse — but PostToolUse only fires when the model calls
// a tool, so a conversational first interaction left the banner invisible.
// The SessionStart hookSpecificOutput.additionalContext pattern is proven
// (see ctx-session-start.js stale-lock notice).

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const STDIN_TIMEOUT_MS = 5000;

function fire(rawInput) {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
  const bannerPath = path.join(pluginRoot, 'forge-banner.txt');

  try {
    if (!fs.existsSync(bannerPath)) {
      process.exit(0);
      return;
    }
    const banner = fs.readFileSync(bannerPath, 'utf8');
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          'Display the following FORGE banner to the user exactly as formatted (preserve the box drawing). Do not add commentary:\n\n' +
          banner,
      },
    }) + '\n');
  } catch (_) {
    // Non-fatal — banner just won't appear
  }

  process.exit(0);
}

// Stdin reader with timeout
let inputData = '';
const timer = setTimeout(() => fire(inputData), STDIN_TIMEOUT_MS);
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => { inputData += line + '\n'; });
rl.on('close', () => {
  clearTimeout(timer);
  fire(inputData);
});
