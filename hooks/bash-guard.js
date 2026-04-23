'use strict';

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { hasValidApprovalToken, STDIN_TIMEOUT_LONG } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_LONG;

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

// ---------------------------------------------------------------------------
// Control file write guard — blocks Bash commands that write to protected
// .pipeline/ control files. workflow-guard.js blocks Write/Edit tool calls to
// these files, but Bash can bypass that via node -e, printf, tee, or shell
// redirects. This section closes that gap.
// ---------------------------------------------------------------------------

const PROTECTED_CONTROL_FILES = [
  'run-active.json',
  'action-approved.json',
  'gate-pending.json',
  'session-dispatch-log.json',
  'project.json',
];

// Mask heredoc bodies so commit messages mentioning control file names or
// "node -e" don't trigger false positives. Heredocs are input (<<), not
// output redirects, so masking them loses no attack signal.
function maskHeredocs(command) {
  return command.replace(/<<-?\s*['"]?(\w+)['"]?\s*\n[\s\S]*?\n\1(?=\s|$)/gm,
    (m) => 'x'.repeat(m.length));
}

function referencesControlFile(command) {
  const safe = maskHeredocs(command);
  return PROTECTED_CONTROL_FILES.some(f => safe.includes(f));
}

function hasBashWriteVector(command) {
  const safe = maskHeredocs(command);
  if (/>\s*['"]?\.pipeline\//.test(safe)) return true;
  if (/>>\s*['"]?\.pipeline\//.test(safe)) return true;
  if (/\btee\b/.test(safe) && /\.pipeline\//.test(safe)) return true;
  if (/\bnode\s+(-e|-p|--eval|--print)\b/.test(safe)) return true;
  if (/\bnpx\b/.test(safe) && /\.pipeline\//.test(safe)) return true;
  if (/\bprintf\b/.test(safe) && hasOutputRedirect(safe)) return true;
  if (/\b(python3?|perl|ruby|pwsh|powershell)\s+(-e|-c)\b/.test(safe) && /\.pipeline\//.test(safe)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Git guard constants and helpers
// ---------------------------------------------------------------------------

/**
 * Patterns that are always hard-blocked on any git command.
 * Each entry is tested against the full original command string (not a single
 * segment) — this catches flags like --force or --no-verify wherever they appear
 * in a chained expression.
 */
const GIT_HARD_BLOCKED_PATTERNS = [
  { pattern: /--force(?:-with-lease)?(?:\s|$)/, reason: '--force / --force-with-lease are forbidden' },
  { pattern: /--no-verify(?:\s|$)/, reason: '--no-verify is forbidden' },
  { pattern: /\bgit\b[^|;&]*commit[^|;&]*--amend/, reason: 'git commit --amend is forbidden' },
  { pattern: /\bgit\b[^|;&]*reset[^|;&]*--hard/, reason: 'git reset --hard is forbidden' },
  { pattern: /\bgit\b[^|;&]*clean[^|;&]*-[a-zA-Z]*f/, reason: 'git clean -f (any variant) is forbidden' },
  { pattern: /\bgit\b[^|;&]*branch[^|;&]*-D/, reason: 'git branch -D (force-delete) is forbidden' },
  { pattern: /\bgit\b[^|;&]*checkout[^|;&]* -- /, reason: 'git checkout -- <path> (discard changes) is forbidden — use `git restore <path>` instead' },
  { pattern: /\bgit\b[^|;&]*stash[^|;&]*drop/, reason: 'git stash drop is forbidden' },
];

/**
 * Git subcommands that require approval (soft-blocked).
 * Key: subcommand string. Value: human-readable label for the block message.
 */
const GIT_SOFT_BLOCKED = {
  commit: 'git commit',
  push: 'git push',
};

/**
 * Extracts the git subcommand from a command segment, skipping -C and -c flags
 * (which each consume one argument). Returns null if the segment is not a git call.
 *
 * Examples:
 *   "git commit -m foo"   → "commit"
 *   "git -C /path push"   → "push"
 *   "git -c key=val log"  → "log"
 *   "echo hello"          → null
 */
function getGitSubcommand(segment) {
  const tokens = segment.trim().split(/\s+/);
  if (tokens.length === 0) return null;

  // Skip leading env var assignments (FOO=bar git ...)
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) {
    i++;
  }
  if (i >= tokens.length || tokens[i] !== 'git') return null;
  i++;

  // Skip git-level flags that each consume one argument: -C and -c
  while (i < tokens.length && (tokens[i] === '-C' || tokens[i] === '-c')) {
    i += 2; // skip flag + its value
  }

  // Skip remaining flags (e.g. --no-pager, --paginate)
  while (i < tokens.length && tokens[i].startsWith('-')) {
    i++;
  }

  return tokens[i] || null;
}

/**
 * Returns true when .pipeline/run-active.json exists and contains a non-empty
 * runId. An active pipeline run means git operations were initiated by the
 * pipeline itself and don't need a separate approval token.
 * Fail-open: any read/parse error returns false.
 */
function hasActivePipelineRun() {
  try {
    const runActivePath = path.join(process.cwd(), '.pipeline', 'run-active.json');
    const raw = fs.readFileSync(runActivePath, 'utf8');
    const data = JSON.parse(raw);
    return typeof data.runId === 'string' && data.runId.length > 0;
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Control file write guard
  // ---------------------------------------------------------------------------
  if (referencesControlFile(command) && hasBashWriteVector(command)) {
    exitBlock(
      '[bash-guard] Blocked: command writes to a protected .pipeline/ control file via Bash. ' +
      'Use the corresponding MCP tool (forge_create_run, forge_set_gate, etc.) or the Write tool instead.'
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // Git guard — check each segment for hard-blocked and soft-blocked patterns
  // ---------------------------------------------------------------------------
  const segments = splitIntoSegments(command);
  for (const segment of segments) {
    const sub = getGitSubcommand(segment);
    if (sub === null) continue; // not a git command segment

    // Hard-block: test the full command string for destructive patterns.
    // (Flags like --force may appear after a subcommand in the same segment;
    // testing the full string catches them regardless of position.)
    for (const { pattern, reason } of GIT_HARD_BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        exitBlock('[bash-guard] Blocked: ' + reason + '. This operation is permanently disabled.');
        return;
      }
    }

    // Soft-block: require pipeline run OR valid approval token
    if (GIT_SOFT_BLOCKED[sub] !== undefined) {
      if (hasActivePipelineRun()) {
        // Active pipeline run — allow (the pipeline initiated this git call)
        continue;
      }
      if (hasValidApprovalToken(sub)) {
        // User explicitly approved this action in their last message — allow
        continue;
      }
      exitBlock(
        '[bash-guard] `' + GIT_SOFT_BLOCKED[sub] + '` requires explicit user approval. ' +
        'Ask the user first — their response will unlock the command.'
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
