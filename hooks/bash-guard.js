'use strict';

const readline = require('readline');

const STDIN_TIMEOUT_MS = 10000;

function exitOk() { process.exit(0); }
function exitBlock(msg) {
  // Emit the modern PreToolUse deny envelope (honored by the Claude Code
  // validator) AND keep the legacy stderr + exit 2 as a backup. workflow-guard.js
  // uses the same belt-and-suspenders pattern; exit 2 alone is silently
  // discarded by the current runtime.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: msg,
      },
    }) + '\n'
  );
  console.error(msg);
  process.exit(2);
}

// Commands that should use dedicated tools instead of Bash
const BLOCKED_COMMANDS = {
  'cat':  'Read',
  'head': 'Read',
  'tail': 'Read',
  'grep': 'Grep',
  'rg':   'Grep',
  'find': 'Glob',
  'ls':   'Glob',
  'sed':  'Edit',
  'awk':  'Edit',
  'wc':   'Read',
};

/**
 * Extracts the first command word from a shell command segment.
 * Strips leading variable assignments (FOO=bar), whitespace, and sudo.
 */
function extractCommandWord(command) {
  if (!command || typeof command !== 'string') return '';

  let trimmed = command.trim();

  // Strip leading variable assignments: FOO=bar BAZ=qux command ...
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s/.test(trimmed)) {
    trimmed = trimmed.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '');
  }

  // Strip sudo
  if (trimmed.startsWith('sudo ')) {
    trimmed = trimmed.slice(5).trim();
  }

  // First whitespace-delimited token is the command word
  const firstToken = trimmed.split(/\s/)[0];
  return firstToken || '';
}

/**
 * Splits a shell command into operator-separated segments so blocked commands
 * chained after an allowed first segment (e.g. `cd . && cat file`) are still
 * detected. Quoted substrings are masked before splitting so operators inside
 * quotes (e.g. `echo "a && b"`) don't cause false segment boundaries. This is
 * intentionally a simple scan — full shell parsing (subshells, command
 * substitution, heredocs) is out of scope; false negatives are preferred over
 * false positives on exotic forms.
 */
function splitIntoSegments(command) {
  if (!command || typeof command !== 'string') return [];
  // Mask quoted substrings so operators inside them don't split segments.
  const masked = command
    .replace(/"(?:\\.|[^"\\])*"/g, s => '"' + 'x'.repeat(Math.max(0, s.length - 2)) + '"')
    .replace(/'(?:\\.|[^'\\])*'/g, s => "'" + 'x'.repeat(Math.max(0, s.length - 2)) + "'");
  const segments = [];
  let start = 0;
  const re = /&&|\|\||;|\|/g;
  let match;
  while ((match = re.exec(masked)) !== null) {
    segments.push(command.slice(start, match.index));
    start = match.index + match[0].length;
  }
  segments.push(command.slice(start));
  return segments.map(s => s.trim()).filter(Boolean);
}

/**
 * Returns the first command word of every operator-separated segment.
 * Used to detect blocked commands anywhere in a chained expression.
 */
function extractAllCommandWords(command) {
  return splitIntoSegments(command)
    .map(seg => extractCommandWord(seg))
    .filter(Boolean);
}

/**
 * Checks if the command contains output redirection (> or >>).
 * Used to distinguish `echo "hello"` (allowed) from `echo "x" > file` (blocked).
 */
function hasOutputRedirect(command) {
  // Simple check: look for > not inside quotes
  // This is intentionally simple — false negatives preferred over false positives
  return /[^>]>[^>]|>>/.test(command);
}

async function main(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    exitOk();
    return;
  }

  const command = payload.tool_input?.command;
  if (!command || typeof command !== 'string') {
    exitOk();
    return;
  }

  const cmdWords = extractAllCommandWords(command);
  if (cmdWords.length === 0) {
    exitOk();
    return;
  }

  // Check every operator-separated segment's first word. If any segment starts
  // with a blocked command, deny the whole expression — chained commands like
  // `cd . && cat file` must not smuggle a blocked command in past an allowed
  // first segment.
  for (const cmdWord of cmdWords) {
    const redirectTool = BLOCKED_COMMANDS[cmdWord];
    if (redirectTool) {
      exitBlock(
        '[bash-guard] Use ' + redirectTool + ' tool instead of `' + cmdWord + '`. ' +
        'Bash is reserved for git, npm, node, and process operations.'
      );
      return;
    }

    // Special case: echo with output redirect should use Write.
    // Redirect check uses the full command (conservative — any redirect anywhere
    // in a chained expression counts, matching the pre-segment-aware behavior).
    if (cmdWord === 'echo' && hasOutputRedirect(command)) {
      exitBlock(
        '[bash-guard] Use Write tool instead of `echo > file`. ' +
        'Bash is reserved for git, npm, node, and process operations.'
      );
      return;
    }
  }

  // Allowed — pass through
  exitOk();
}

// -- Stdin reader with timeout guard -----------------------------------------
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
