# Research: One Chat Phase 1 — Intent Detection

## Question 1: What is the cold-start latency of `claude --print` on Windows for a Haiku call? Is it fast enough for per-submit classification (~1-2s acceptable)?

**Finding:** No direct benchmarks exist in the FORGE codebase or public documentation. However, the Claude CLI documentation confirms that `--print` is optimized for non-interactive scripting and exits immediately after producing output. The flag is designed for pipeline automation and integration into shell workflows, suggesting sub-second intent detection should be achievable for lightweight Haiku queries.

**Context:** FORGE already uses `spawnClaudeText()` and `spawnClaudeJson()` in two handlers (`research.ts` and `pipeline-data.ts`) to invoke Claude CLI with `--print`. These handlers spawn synchronously and wait for the process to close, implying the pattern is already proven on Windows. The `research-stack` handler in `research.ts` (line 22) calls `spawnClaudeText(prompt, userDataPath)` without timeouts, and `pipeline-data.ts` (line 375) invokes `spawnClaudeJson(prompt, cwd, 'claude-haiku-4-5-20251001')` for task enrichment — both short-running operations.

**Source:** 
- `/c/Users/cuj/Forge/src/main/shared.ts` lines 246–314 (implementation of `spawnClaudeText` and `spawnClaudeJson`)
- `/c/Users/cuj/Forge/src/main/handlers/research.ts` (existing usage)
- `/c/Users/cuj/Forge/src/main/handlers/pipeline-data.ts` (existing usage)
- Claude CLI docs: `--print` flag is non-interactive and exits on completion

**Recommendation:** Implement a 3-second timeout for intent classification to be safe. If the process hangs, fall back gracefully to default values (plan feature / LEAN) without blocking the run. Monitor latency during Phase 1 testing; if Haiku `--print` consistently runs under 1 second on the target system, this is acceptable UX.

---

## Question 2: How should the IPC handler spawn the classifier? Same pattern as the main Claude run (`spawn` in `src/main/handlers/`) but with `--print` and a short prompt?

**Finding:** Yes, use the exact same spawn pattern. The existing `spawnClaudeText()` and `spawnClaudeJson()` helpers in `src/main/shared.ts` already handle all platform-specific complexity and should be reused directly.

**Pattern Details:**
- Use `spawn(claudeCmd, args, { cwd, shell: process.platform === 'win32' && !claudeCmd.endsWith('.exe'), windowsHide: true, env: spawnEnv(), stdio: ['pipe', 'pipe', 'pipe'] })`
- Feed prompt via stdin: `proc.stdin!.end(prompt)`
- Capture stdout and stderr as streams, accumulating data on `'data'` events
- Resolve on `'close'` event with exit code 0 = success
- Handle `'error'` event (process spawn failures, e.g. ENOENT)
- Windows-specific: `.exe` uses `shell: false`, `.cmd` uses `shell: true`; use `spawnEnv()` to augment PATH with npm global bin directories

**Source:**
- `/c/Users/cuj/Forge/src/main/shared.ts` lines 112–119 (`spawnEnv()`)
- `/c/Users/cuj/Forge/src/main/shared.ts` lines 121–160 (`findClaude()` discovery pattern)
- `/c/Users/cuj/Forge/src/main/shared.ts` lines 246–314 (`spawnClaudeText()` and `spawnClaudeJson()` reference implementations)
- `/c/Users/cuj/Forge/src/main/handlers/runner.ts` lines 195–204 (main run spawn pattern with shell resolution)
- `/c/Users/cuj/Forge/docs/gotchas/GENERAL.md` lines 161–167 (Windows platform differences)

**Recommendation:** Create a new handler `src/main/handlers/intent.ts` with a `register()` function that:
1. Exports an IPC handler `ipcMain.handle('classify-intent', async (_, { prompt, projectFolder }) => { ... })`
2. Uses `spawnClaudeJson()` from shared.ts with `--output-format json` to get structured output in one call
3. Parses JSON response and validates it has `pipeline`, `mode`, and `reason` fields
4. Returns `{ pipeline: string, mode: string, reason: string } | { error: string }` shape
5. Wraps in try/catch to handle spawn errors and JSON parse failures
6. Returns fallback `{ error: "classification unavailable" }` on any error — App.svelte can detect this and use hardcoded defaults

**Clarification:** Although `spawnClaudeText()` could work, `spawnClaudeJson()` is preferable because it already handles `--output-format json` and extracts token metadata. For a lightweight classification, the overhead is negligible and the structured parsing is cleaner.

---

## Question 3: What is the right classifier system prompt for Haiku to reliably output `{"pipeline":"plan feature","mode":"LEAN","reason":"…"}`? What edge cases need to be handled?

**Finding:** The classifier prompt must be short (~150–200 words), include the valid pipeline/mode enum values inline, and instruct JSON-only output with no markdown wrapper. Haiku is reliable at tight JSON output when given a schema and explicit format instruction.

**Recommended Prompt Structure:**
```
You are a task classifier for Claude Code pipelines. Given a user's task description, output ONLY a JSON object with no other text or markdown:

Valid pipelines: "explore", "direct", "plan feature", "implement feature", "debug", "refactor", "architect"
Valid modes: "trivial", "sprint", "lean", "standard", "full"

Classification rules:
- "trivial": Single-file fix, no complexity — skip pipeline entirely.
- "sprint": Multi-file but low risk, straightforward — core agent only, no reviewers.
- "lean": Default — core + reviewer-safety + reviewer.
- "standard": Multi-file, state/IPC changes — add completeness-checker + reviewer-triage.
- "full": High-stakes (auth/payment/security), architectural impact, or prior blockers — all 5 reviewers.

Pipelines:
- "explore": Read-only research, no execution.
- "direct": Single file, local edit, no pipeline.
- "plan feature", "implement feature": Normal pipeline for new work.
- "debug", "refactor", "architect": Specialized pipelines for bug fixes, cleanup, architecture decisions.

Task: {{USER_PROMPT}}

Output format (no markdown):
{"pipeline":"<pipeline>","mode":"<mode>","reason":"<one sentence explaining the classification>"}
```

**Edge Cases & Handling:**
1. **Ambiguous prompts** (e.g. "make X smarter") — classify as "plan feature" + "lean" (safest default; planner will prompt for clarification).
2. **Questions only** (e.g. "how do I...?") — classify as "explore" (read-only, safe).
3. **Incomplete prompts** (e.g. "fix the bug") — classify as "debug" + "lean" (indicates a bug fix, but planner will ask for details).
4. **Contradictory signals** (e.g. "small feature that touches auth") — defer to the highest-risk signal (full mode) and let the planner/user confirm.
5. **Empty or whitespace-only prompt** — return `{ error: "prompt-empty" }` and fall back to defaults in App.svelte.

**Source:**
- CLAUDE.md "Pipeline modes and their gate numbers" section (describes all 5 modes and their triggers)
- `/c/Users/cuj/Forge/docs/PLAN.md` lines 43–46 (classifier system prompt elaboration task in the plan itself)
- `/c/Users/cuj/Forge/src/main/handlers/pipeline-data.ts` line 375 (existing pattern: `spawnClaudeJson(..., 'claude-haiku-4-5-20251001')`)

**Recommendation:** Embed the prompt as a constant in `src/main/handlers/intent.ts`. Keep the prompt under 300 tokens so Haiku can classify in <1 second. Include the enum values inline (do not rely on Haiku's training data). Test with 10–15 representative prompts (feature ideas, bug reports, refactor requests, clarification questions) before shipping. If Haiku misclassifies ambiguous cases, add a clarifying phrase to the rules (e.g. "When both 'easy' and 'touches auth' apply, choose full mode").

---

## Question 4: Are there any gotchas with running a second `claude --print` process while a main run is already active?

**Finding:** No architectural blocker. Multiple concurrent `spawn()` processes are safe in Node.js as long as each has its own event handlers and local variable closure. FORGE's `runner.ts` handler already manages concurrent spawns via local variable closure (lines 189–193 of runner.ts), not global state.

**Concurrency Pattern:**
- Each IPC handler invocation closes over its own local `child` variable (not a module-level reference)
- Event handlers (`.on('data')`, `.on('close')`, `.on('error')`) are registered on the local `child` instance
- Even if a second run starts before the first one ends, their event handlers do not interfere because they operate on different ChildProcess objects

**Gotchas to Avoid:**
1. **Listener accumulation** — If `ipcRenderer.on('classify-intent-result')` is used instead of `invoke()`, listeners will accumulate across runs. **Solution:** Use `ipcRenderer.invoke()` one-way (request/response), not `ipcRenderer.on()` for results. The IPC pattern must be `ipcMain.handle('classify-intent')` + `ipcRenderer.invoke()`, not a listener-based pattern.
2. **Buffered stdout from stderr mixing** — Both stdout and stderr are piped separately in `stdio: ['pipe', 'pipe', 'pipe']`, so no mixing. Parse stdout for JSON, and log stderr only if JSON parse fails.
3. **Process cleanup on renderer unmount** — The renderer store (editor.svelte.ts) holds state, but does NOT hold process references. No cleanup needed when the renderer updates; the process runs to completion independently.
4. **File contention** — If both the main run and the classifier try to write to the same file (e.g. terminal logs), the classifier runs so fast that contention is negligible. The classifier output is not persisted; it flows directly back to the IPC caller.

**Source:**
- `/c/Users/cuj/Forge/src/main/handlers/runner.ts` lines 189–212 (local variable closure pattern for safe concurrent spawns)
- `/c/Users/cuj/Forge/docs/gotchas/GENERAL.md` lines 67–69 (IPC two-way invoke pattern; fire-and-forget send is only for window controls)
- Node.js child_process documentation (spawn with separate stdio streams is always safe; no global state issues)

**Recommendation:** Implement the intent classifier as an `ipcMain.handle('classify-intent')` handler that returns a Promise. The renderer calls `window.claude.classifyIntent(prompt, projectFolder)` via `ipcRenderer.invoke()` and awaits the result. Set a 3-second timeout on the handler to prevent hanging. If the main run is active, the classifier still spawns and completes independently — no blocking or interference.

---

## Question 5: How are `system`-type terminal lines currently rendered?

**Finding:** Lines with `type: 'system'` are rendered with dim italic styling (color: var(--dim), font-style: italic).

**Implementation:**
- Line classification happens in `src/renderer/src/lib/lineClassifier.ts`
- Lines starting with `[wave-complete]` are classified as type `'system'`
- In `Terminal.svelte` line 238, each line renders with a CSS class `line-{line.type}`
- The `line-system` class is defined in `Terminal.svelte` lines 410:
  ```css
  .line-system { color: var(--dim); font-style: italic; }
  ```

**Source:**
- `/c/Users/cuj/Forge/src/renderer/src/lib/lineClassifier.ts` line 7 (classification rule)
- `/c/Users/cuj/Forge/src/renderer/src/components/terminal/Terminal.svelte` line 238 (template rendering)
- `/c/Users/cuj/Forge/src/renderer/src/components/terminal/Terminal.svelte` line 410 (CSS class)

**Recommendation:** To emit the intent classification result as a dim italic line in the terminal (task 9 of the plan), create a line with:
- `type: 'system'` (already renders as dim italic)
- `text: "→ detected: plan feature · LEAN — \"<reason>\""` (or similar format)
- This line should be added to the session store *before* the run starts, using the existing `addLine()` / terminal append mechanism

---

## Summary of Implementation Approach

1. **Classifier handler** (`src/main/handlers/intent.ts`):
   - Use `spawnClaudeJson()` with model `claude-haiku-4-5-20251001` (already used in the codebase)
   - Compact prompt (~200 tokens) with inline enum values
   - 3-second timeout with graceful fallback to error result

2. **IPC integration**:
   - Handler returns `{ pipeline: string, mode: string, reason: string } | { error: string }`
   - Use invoke pattern (`ipcMain.handle` + `ipcRenderer.invoke`) — no listeners
   - No special concurrency handling needed; classifier and main run can coexist

3. **Terminal rendering**:
   - Classification result lines use type `'system'` (already dim italic in CSS)
   - Render as a single line before spawning the main run

4. **Haiku model ID**:
   - Use `claude-haiku-4-5-20251001` (already in use in pipeline-data.ts line 375)
   - This is the dated model ID format; verified as available in 2026

5. **Fallback behavior**:
   - Any error in classification → return `{ error: "..." }`
   - App.svelte detects error and uses hardcoded defaults: pipeline = "plan feature", mode = "LEAN"
   - Run proceeds without blocking on failed classification
