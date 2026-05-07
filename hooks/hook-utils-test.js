'use strict';
// Regression tests for hooks/hook-utils.js resolveProjectDir() and resolvePluginRoot()
// Run: node hooks/hook-utils-test.js

const path = require('path');
const { resolveProjectDir, resolvePluginRoot, stripAnsi } = require('./hook-utils');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  PASS  ' + label);
    passed++;
  } else {
    console.error('  FAIL  ' + label);
    failed++;
  }
}

const actual = process.cwd();

// Capture stderr to verify warning messages without polluting test output
const stderrLines = [];
const origStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (data, ...rest) => {
  stderrLines.push(String(data));
  return origStderr(data, ...rest);
};

function lastStderr() { return stderrLines[stderrLines.length - 1] || ''; }

console.log('\n── hook-utils-test.js ───────────────────────────────────────────────────');

// 1. Matching absolute cwd is accepted; worktree suffix stripped when present
{
  const result = resolveProjectDir({ cwd: actual });
  // If running from a worktree, result is the project root (parent of .worktrees/r-<id>)
  // If running from a non-worktree, result is actual (unchanged)
  const wtMatch = actual.replace(/[/\\]+$/, '').match(/^(.+)[/\\]\.worktrees[/\\]r-[a-zA-Z0-9]+$/i);
  const expected = wtMatch ? path.normalize(wtMatch[1]) : actual;
  assert(result === expected, 'matching absolute cwd: returns project root (strips worktree suffix if present)');
}

// 2. Missing cwd falls back to process.cwd() silently
{
  const before = stderrLines.length;
  const result = resolveProjectDir({});
  assert(result === actual, 'missing cwd: falls back to process.cwd()');
  assert(stderrLines.length === before, 'missing cwd: no stderr warning emitted');
}

// 3. Non-absolute cwd falls back with warning
{
  const result = resolveProjectDir({ cwd: 'relative/path' });
  assert(result === actual, 'non-absolute cwd: falls back to process.cwd()');
  assert(lastStderr().includes('not absolute'), 'non-absolute cwd: stderr warning emitted');
}

// 4. Mismatched absolute cwd falls back with warning
{
  const result = resolveProjectDir({ cwd: '/tmp/attacker-controlled' });
  assert(result === actual, 'mismatched cwd: falls back to process.cwd()');
  assert(lastStderr().includes('mismatch'), 'mismatched cwd: stderr warning mentions mismatch');
}

// 5. Non-string cwd falls back silently
{
  const before = stderrLines.length;
  const result = resolveProjectDir({ cwd: 42 });
  assert(result === actual, 'non-string cwd: falls back to process.cwd()');
  assert(stderrLines.length === before, 'non-string cwd: no stderr warning');
}

// 6. Null payload falls back silently
{
  const before = stderrLines.length;
  const result = resolveProjectDir(null);
  assert(result === actual, 'null payload: falls back to process.cwd()');
  assert(stderrLines.length === before, 'null payload: no stderr warning');
}

// 7. Path traversal attempt rejected
{
  const result = resolveProjectDir({ cwd: actual + '/../../../etc' });
  assert(result === actual, 'path traversal attempt: falls back to process.cwd()');
  assert(lastStderr().includes('mismatch'), 'path traversal attempt: stderr warning emitted');
}

// ── worktree strip regex ──────────────────────────────────────────────────────
// resolveProjectDir() can't be called with a worktree-shaped path in a test
// runner (process.cwd() won't match), so we test the stripping regex directly.

{
  console.log('\n── worktree strip regex ─────────────────────────────────────────────────');

  // The regex used inside resolveProjectDir for worktree detection:
  function extractProjectRoot(p) {
    const normalized = p.replace(/[/\\]+$/, '');
    const m = normalized.match(/^(.+)[/\\]\.worktrees[/\\]r-[a-zA-Z0-9]+$/i);
    return m ? require('path').normalize(m[1]) : null;
  }

  // 18. Unix-style worktree path stripped to project root
  assert(
    extractProjectRoot('/home/user/myproject/.worktrees/r-abc123') === require('path').normalize('/home/user/myproject'),
    'worktree strip: unix path → project root'
  );

  // 19. Windows-style path (forward slashes) — platform-aware
  {
    const result = extractProjectRoot('C:/Users/cuj/forge-plugin/.worktrees/r-a3f11c90');
    const expected = require('path').normalize('C:/Users/cuj/forge-plugin');
    assert(result === expected, 'worktree strip: windows path with forward slashes → project root');
  }

  // 20. Non-worktree path returns null (no stripping)
  assert(
    extractProjectRoot('/home/user/myproject') === null,
    'worktree strip: non-worktree path → null (not stripped)'
  );

  // 21. Path containing .worktrees but with invalid run ID format not stripped
  assert(
    extractProjectRoot('/home/user/myproject/.worktrees/not-a-run-id') === null,
    'worktree strip: invalid run ID format → null (not stripped)'
  );

  // 22. Trailing slash on worktree path stripped cleanly
  assert(
    extractProjectRoot('/home/user/myproject/.worktrees/r-abc123/') === require('path').normalize('/home/user/myproject'),
    'worktree strip: trailing slash handled'
  );

  // 23. Nested project root — only innermost worktree stripped
  assert(
    extractProjectRoot('/projects/.worktrees/r-outer/subproject/.worktrees/r-abc123') === require('path').normalize('/projects/.worktrees/r-outer/subproject'),
    'worktree strip: nested worktrees — strips innermost only'
  );
}

// ── resolvePluginRoot() tests ─────────────────────────────────────────────────

const trustedRoot = path.resolve(__dirname, '..');
const origEnv = process.env.CLAUDE_PLUGIN_ROOT;

// 8. Env unset → hook-derived root, no warning
{
  delete process.env.CLAUDE_PLUGIN_ROOT;
  const before = stderrLines.length;
  const result = resolvePluginRoot();
  assert(result === trustedRoot, 'CLAUDE_PLUGIN_ROOT unset: returns hook-derived root');
  assert(stderrLines.length === before, 'CLAUDE_PLUGIN_ROOT unset: no stderr warning');
}

// 9. Env matches hook-derived root → accepted, no warning
{
  process.env.CLAUDE_PLUGIN_ROOT = trustedRoot;
  const before = stderrLines.length;
  const result = resolvePluginRoot();
  assert(result === trustedRoot, 'CLAUDE_PLUGIN_ROOT matches: accepted');
  assert(stderrLines.length === before, 'CLAUDE_PLUGIN_ROOT matches: no stderr warning');
}

// 10. Env is non-absolute → warned + fallback
{
  process.env.CLAUDE_PLUGIN_ROOT = 'relative/path/to/plugin';
  const result = resolvePluginRoot();
  assert(result === trustedRoot, 'CLAUDE_PLUGIN_ROOT non-absolute: falls back to hook-derived root');
  assert(lastStderr().includes('not absolute'), 'CLAUDE_PLUGIN_ROOT non-absolute: warning emitted');
}

// 11. Env is absolute but mismatched → warned + fallback
{
  process.env.CLAUDE_PLUGIN_ROOT = '/tmp/attacker-plugin';
  const result = resolvePluginRoot();
  assert(result === trustedRoot, 'CLAUDE_PLUGIN_ROOT mismatched: falls back to hook-derived root');
  assert(lastStderr().includes('mismatch'), 'CLAUDE_PLUGIN_ROOT mismatched: warning emitted');
}

// Restore env
if (origEnv !== undefined) process.env.CLAUDE_PLUGIN_ROOT = origEnv;
else delete process.env.CLAUDE_PLUGIN_ROOT;

// ── stripAnsi() tests ─────────────────────────────────────────────────────────

// 12. Safe text preserved unchanged
assert(stripAnsi('normal text') === 'normal text', 'stripAnsi: safe text unchanged');
assert(stripAnsi('r-abc123') === 'r-abc123', 'stripAnsi: run ID unchanged');

// 13. CSI escape sequences stripped (colour, cursor, clear-screen)
assert(!stripAnsi('\x1b[2J\x1b[0;0H').includes('\x1b'), 'stripAnsi: clear-screen CSI stripped');
assert(!stripAnsi('\x1b[31mred\x1b[0m').includes('\x1b'), 'stripAnsi: colour CSI stripped');
assert(stripAnsi('\x1b[31mred\x1b[0m').includes('red'), 'stripAnsi: text inside CSI preserved');

// 14. OSC sequences stripped (title-setting, hyperlinks)
assert(!stripAnsi('\x1b]0;window title\x07').includes('\x1b'), 'stripAnsi: OSC title sequence stripped');

// 15. Control characters stripped (C0 except \t \n \r)
assert(!stripAnsi('before\x00after').includes('\x00'), 'stripAnsi: null byte stripped');
assert(!stripAnsi('before\x08after').includes('\x08'), 'stripAnsi: backspace stripped');
assert(!stripAnsi('before\x1bafter').includes('\x1b'), 'stripAnsi: bare ESC stripped');

// 16. Tab, newline, carriage return preserved
assert(stripAnsi('a\tb') === 'a\tb', 'stripAnsi: tab preserved');
assert(stripAnsi('a\nb') === 'a\nb', 'stripAnsi: newline preserved');

// 17. Non-string coerced to string
assert(stripAnsi(null) === '', 'stripAnsi: null coerced to empty string');
assert(stripAnsi(42) === '42', 'stripAnsi: number coerced to string');

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
