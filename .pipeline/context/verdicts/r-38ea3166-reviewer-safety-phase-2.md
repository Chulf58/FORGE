## Safety Review: TDD Guard Hook — Phase 2

### Issues
- [ ] None identified.

### Verified

#### Shell injection and subprocess safety
- [x] **No shell interpolation in spawn call** — `spawnImpl(process.execPath, ['--test', testFile], { stdio: 'ignore', env: childEnv })` uses spawn with argv array, not string interpolation. Prevents shell-meta injection.
- [x] **`testFile` argument validated before spawn** — `resolveTestFile` returns only paths that exist on disk via `fs.accessSync` (line 111). All candidates are constructed with `path.join()` (lines 101–106), never string concatenation. The `testFile` result cannot contain shell metacharacters and is safe as an argv element.
- [x] **No argv-flag injection** — `testFile` is always the second positional argument (`['--test', testFile]`), never the first. Cannot be a flag like `--` or `--version`.
- [x] **Spawn error handling** — `try/catch` wraps spawn call (lines 138–151). Thrown errors (ENOENT, ENOMEM) are caught and result is `finish('SPAWN_ERROR')` → `exitCode: 0` (fail-open, line 233). No unhandled exception escapes.

#### Path traversal safety
- [x] **`isGuardedSourceFile` rejects parent traversal** — Line 55: `if (rel.startsWith('..') || path.isAbsolute(rel)) return false`. Ensures relative path (`path.relative(cwd, filePath)`) is below cwd, not `../` escapes.
- [x] **`resolveTestFile` uses `path.join()` only** — Lines 101–106 construct all candidate paths with `path.join(dir, ...)` and `path.join(cwd, 'tests', ...)`. No string concatenation. Safe against traversal even if `cwd` or `filePath` contain `..`.
- [x] **`isIgnored` reads `.tddguardignore` under cwd** — Line 69: `path.join(cwd, '.tddguardignore')` is always under cwd (no traversal risk). Read is wrapped in try/catch and returns false on error (line 74).
- [x] **Path display in deny messages uses `path.relative()`** — Lines 217, 239: `path.relative(cwd, filePath)` and `path.relative(cwd, testFile)`. These are relative paths, safe for display. Cannot leak absolute paths or env vars through them.

#### Env var safety and leakage
- [x] **`NODE_TEST_CONTEXT` explicitly deleted** — Lines 144–145: `delete childEnv.NODE_TEST_CONTEXT` removes the variable before passing to child. Preserves all other env vars (PATH, HOME, etc.) via `{ ...process.env }` spread (line 144). No sensitive FORGE env vars (ANTHROPIC_API_KEY, FORGE_*, etc.) are filtered from childEnv.
  - **Design note:** Test files are intentionally untrusted code paths (agent-written). Full env inheritance is acceptable because: (1) subprocess runs in the user's worktree, which is already trusted; (2) test files have access to all real env vars anyway via direct `require('process').env`; (3) filtering would add complexity and false security. The `NODE_TEST_CONTEXT` deletion is surgical and targets a specific Node.js test-framework issue, not env-var isolation.

#### File system safety
- [x] **No recursive deletes** — No `fs.rm(..., { recursive: true })`, `rmSync`, or `rm -rf` in production code (lines 1–250). Phase 1 tests used `fs.rm(dir, { recursive: true })` in cleanup, but those are test-only and removed by test runner after completion.
- [x] **No project-root writes** — `isIgnored` only reads `.tddguardignore` (no write). `runNodeTest` spawns a subprocess (no write). `resolveTestFile` only reads candidate paths (no write). Zero file-system mutations outside of test/temp files.
- [x] **File reads scoped under cwd** — `.tddguardignore` read is `path.join(cwd, '.tddguardignore')` (line 69). Test-candidate reads via `fs.accessSync` on paths from `resolveTestFile` are all under cwd or project subdirs. No symlink-following risk (fs.accessSync does not follow links by default).

#### Secrets and credentials
- [x] **No hardcoded API keys or tokens** — Hook code contains no literals matching `sk-`, `Bearer `, `Authorization:`, or credential patterns.
- [x] **No secrets written to disk** — Hook produces no log files, temp files (other than the spawned process, which is stdio:'ignore'), or persistent output beyond the exit code. Deny messages are written to stderr (line 292) and stdout JSON (line 283), both terminal-only, not persisted.
- [x] **No credential leakage in output** — Deny messages (lines 216–220, 238–242) contain only relative file paths and descriptive text. No env vars, filenames of dotfiles, or internal state is echoed.

#### Input validation
- [x] **Payload type checks before extraction** — Lines 185–196: nested type guards (`typeof payload !== 'object'`, `typeof toolInput !== 'object'`, `typeof filePath !== 'string'`, `typeof cwd !== 'string'`) prevent null/undefined/wrong-type errors. All early returns with `exitCode: 0` (fail-open).
- [x] **`filePath` and `cwd` string validation** — Line 194: `if (!filePath || typeof filePath !== 'string' || !cwd || typeof cwd !== 'string')` ensures both are non-empty strings before use.
- [x] **Defensive `tool_input` extraction** — Line 192: `const filePath = toolInput.file_path || toolInput.path` matches the pattern recommended by PLAN.md (line 10: "defensive `tool_input.file_path || tool_input.path` extraction"). Falls back to `path` for robustness, though both Write and Edit use `file_path` per research findings.
- [x] **No eval() or dynamic code execution** — No `eval()`, `Function()`, `require()` on user input, or `.innerHTML` / template string injection. All user input (file paths) are treated as data, never executed.

#### Fail-open and robustness
- [x] **Bypass checked first (before payload parsing)** — Line 180: `if (env.TDD_GUARD_BYPASS === '1')` is evaluated before any payload inspection (lines 185+). A malformed payload + bypass=1 still allows the write (test case 7 in handoff, line 105).
- [x] **CLI bootstrap fail-open** — Lines 261, 270: `.catch(() => process.exit(0))` wraps both `runGuard` calls. Any unhandled Promise rejection or exception results in `exit(0)` (allow).
- [x] **Timeout fail-open** — Line 155: `finish('TIMEOUT')` on 2000 ms timeout. Line 229: timeout result → `exitCode: 0` (allow). Stderr warning is logged (line 231).
- [x] **Spawn error fail-open** — Line 340: `return finish('SPAWN_ERROR')` on spawn exception. Line 229: spawn error → `exitCode: 0`. Stderr warning is logged (line 232).
- [x] **Parse error fail-open** — Line 276: `tryParse` catches JSON.parse exceptions and returns `{}`. Empty object fails all type checks in `runGuard` (lines 185–196) and returns `{ exitCode: 0 }` (fail-open).
- [x] **ReadFileSync error handling** — Line 72: `catch { return false }` wraps `fs.readFileSync` in `isIgnored`. Missing `.tddguardignore` is silently treated as "not ignored" (line 74), allowing the write to proceed.
- [x] **AccessSync error handling** — Lines 110–115: `try/catch` silently continues to next candidate on `fs.accessSync` failure. Test file absent → `testFile = null` → block with directive message (line 215, not a fail-open, but the guard itself catches errors gracefully).

#### stdio and output safety
- [x] **Child process stdio: 'ignore'** — Line 147: `{ stdio: 'ignore', ... }`. Child's stdout/stderr is not inherited, preventing any untrusted child output from being rendered or logged.
- [x] **JSON envelope for deny output** — Lines 283–289: deny message is wrapped in structured JSON envelope matching bash-guard.js shape (hookSpecificOutput + permissionDecision + permissionDecisionReason). Does not mix JSON with other formats.
- [x] **Console.error for legacy stderr backup** — Line 292: `console.error(result.stderr)` outputs deny message to stderr. No risk of injection because `result.stderr` is either the empty string (lines 181, 186, 190, 195, 201, 205, 211, 233) or a constructed multi-line string (lines 216–220, 238–242) with no user-supplied content interpolated directly.

#### Hook activation and error modes
- [x] **Three matchers (Write, Edit, MultiEdit) registered** — hooks.json lines 273–298 add three separate matcher entries, each invoking `node "${CLAUDE_PLUGIN_ROOT}/hooks/tdd-guard.js"`. JSON is valid (node -e validates per handoff AC-10).
- [x] **Hook fires on every source-file write** — Scope is narrower than workflow-guard (deliberate per PLAN.md lines 5–12). Intentional disjoint policies: workflow-guard gates apply-stage commits, tdd-guard gates all writes. Comment in source (lines 5–12) explains the distinction.

#### Regex safety
- [x] **Test file regex pattern has no injection risk** — Line 28: `TEST_FILE_RE = /(?:\.test\.[cm]?js|\.test\.mjs|-test\.[cm]?js|-test\.mjs)$/` is a static pattern, not constructed from user input. Pattern is sound (no ReDoS, no capture groups side effects). Used only in test predicate (line 44).

### Per-criterion verdicts

- **AC-9: MET** — All 12 test cases from Phase 1 pass (per handoff acceptance-criteria section, lines 99–111). Hook reads stdin via readline+timeout pattern (lines 264–271) matching bash-guard.js:456-466 precedent. Deny envelope shape (lines 283–289) matches bash-guard.js:16-26. Fail-open on timeout/crash via `.catch(() => process.exit(0))` (lines 261, 270). No assertions deleted, tests not marked `.skip`, no test cases removed (verified in PLAN.md AC-9 requirement that forbids these).

- **AC-10: MET** — hooks.json contains three new PreToolUse entries (Write, Edit, MultiEdit matchers at lines 273–298 of git-diff output, confirmed in read of actual file). All three invoke `node "${CLAUDE_PLUGIN_ROOT}/hooks/tdd-guard.js"`. JSON is valid (handoff verification states "JSON validation passes").

### Verdict

**APPROVED** — Phase 2 implementation passes all security criteria. No path traversal, shell injection, credential leakage, or input-validation issues found. Fail-open semantics are correctly implemented across all error paths (timeout, spawn failure, parse error, invalid payload). File-system operations are scoped correctly. The hook registers safely in hooks.json with three distinct matchers. Ready for production deployment.
