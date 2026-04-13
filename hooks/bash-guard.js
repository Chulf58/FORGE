'use strict';

const readline = require('readline');

const STDIN_TIMEOUT_MS = 10000;

function exitOk() { process.exit(0); }
function exitBlock(msg) {
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
 * Extracts the first command word from a shell command string.
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

  const cmdWord = extractCommandWord(command);
  if (!cmdWord) {
    exitOk();
    return;
  }

  // Check blocked commands map
  const redirectTool = BLOCKED_COMMANDS[cmdWord];

  if (redirectTool) {
    // Special case: echo and cat are only blocked with output redirection
    if (cmdWord === 'cat' && !hasOutputRedirect(command)) {
      // cat without redirect — still blocked (should use Read)
      // Only cat << heredoc WITH redirect is the write case,
      // but plain cat is always a read
    }

    exitBlock(
      '[bash-guard] Use ' + redirectTool + ' tool instead of `' + cmdWord + '`. ' +
      'Bash is reserved for git, npm, node, and process operations.'
    );
    return;
  }

  // Special case: echo with output redirect should use Write
  if (cmdWord === 'echo' && hasOutputRedirect(command)) {
    exitBlock(
      '[bash-guard] Use Write tool instead of `echo > file`. ' +
      'Bash is reserved for git, npm, node, and process operations.'
    );
    return;
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
