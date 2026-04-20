'use strict';

// forge-banner.js — SessionStart hook
// Prints the FORGE banner directly to stderr so it appears visibly in the
// user's terminal at session startup. This is the primary user-facing output.
//
// Additionally emits the banner as hookSpecificOutput.additionalContext so the
// model has awareness of FORGE's presence and available commands — but model
// context injection is NOT reliable for direct user display (the model may or
// may not render it), so stderr is the authoritative visible surface.
//
// History:
//   v1: flag-file → PostToolUse pickup (invisible on conversational first turns)
//   v2: hookSpecificOutput.additionalContext only (model context, not user display)
//   v3 (current): stderr direct print + additionalContext for model awareness

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolvePluginRoot } = require('./hook-utils');

const STDIN_TIMEOUT_MS = 5000;

function fire(rawInput) {
  const pluginRoot = resolvePluginRoot();
  const bannerPath = path.join(pluginRoot, 'forge-banner.txt');

  try {
    if (!fs.existsSync(bannerPath)) {
      process.exit(0);
      return;
    }
    const banner = fs.readFileSync(bannerPath, 'utf8');

    let version = null;
    try {
      const pluginMeta = JSON.parse(
        fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
      );
      if (typeof pluginMeta.version === 'string' && pluginMeta.version.length > 0) {
        version = pluginMeta.version;
      }
    } catch (_) {
      // fail-open: version stays null, banner still prints
    }

    const versionLine = version !== null ? `\nFORGE v${version}` : '';

    // Primary: direct terminal output — visible immediately at startup.
    process.stderr.write(banner + versionLine + '\n');

    // Secondary: model context injection — gives the model awareness of FORGE
    // commands for its first response. Not relied upon for user display.
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          'FORGE plugin is active. Available commands: /forge:plan, /forge:implement, /forge:apply, /forge:debug, /forge:refactor, /forge:status, /forge:dashboard, /forge:resume, /forge:todo, /forge:approve, /forge:discard, /forge:init. The user has already seen the FORGE startup banner in their terminal.',
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
