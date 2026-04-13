'use strict';

// forge-banner.js — SessionStart hook
// Creates a banner-pending flag file. The first PostToolUse hook invocation
// (ctx-post-tool.js) picks it up, injects the banner as additionalContext,
// and deletes the flag. This ensures the banner appears once on the first
// model response that follows a tool call — reliable and visible.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const STDIN_TIMEOUT_MS = 5000;

function fire(rawInput) {
  // Write a flag file that ctx-post-tool.js will pick up
  const projectDir = process.cwd();
  const flagPath = path.join(projectDir, '.pipeline', 'forge-banner-pending');

  try {
    // Ensure .pipeline/ exists
    const pipelineDir = path.join(projectDir, '.pipeline');
    if (!fs.existsSync(pipelineDir)) {
      fs.mkdirSync(pipelineDir, { recursive: true });
    }
    fs.writeFileSync(flagPath, Date.now().toString(), 'utf8');
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
