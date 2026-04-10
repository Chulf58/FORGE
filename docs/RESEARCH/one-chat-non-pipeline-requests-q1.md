# Research: One Chat Non-Pipeline Request Handling

## Question 1: spawnClaudeJson vs runner.ts spawn path for run-chat

**Finding:** 

The `runner.ts` streaming path (NOT `spawnClaudeJson`) is the correct choice for `run-chat`. Here's why:

**spawnClaudeJson limitations:**
- Uses `--print --output-format json` (line 281 of `shared.ts`) — JSON-only output, suitable for one-shot processing
- Accumulates all stdout into a single `raw` string buffer (line 293) 
- Resolves only when the process closes (line 298), at which point it parses the entire output as JSON (line 301)
- Signal parsing would have to happen **after** the full response is received — signals cannot be processed in real-time

**runner.ts streaming capabilities:**
- Uses `--output-format stream-json` (line 94 of `runner.ts`) — emits JSON events incrementally
- Processes each chunk immediately via `stdout.on('data')` event handler (lines 278–382)
- Parses JSON per-line (line 286) and dispatches `claude-stdout` IPC events immediately (line 287 or 306)
- Extracts assistant text blocks and sends them line-by-line to the renderer via `win.webContents.send('claude-stdout', line)` (line 306)
- Also extracts tool_result blocks from sub-agent Task completions and forwards only FORGE_SIGNAL_PREFIXES lines (line 358–359)

**The critical requirement:**
`run-chat` needs signals (specifically `[todo]`) to be processed **as Claude produces them**, not after the run completes. The App.svelte `onStdout` handler (line 231) receives IPC events and classifies them in real-time — checking for signal prefixes like `TODO_PREFIX` (line 316). 

With `spawnClaudeJson`, all output arrives in one block after completion, and signals would need manual extraction from the JSON result string. With `runner.ts` streaming, signals are automatically captured and sent as individual `claude-stdout` IPC events, hitting App.svelte's classifier immediately.

**Source:** 
- `src/main/shared.ts` lines 274–314 (spawnClaudeJson function)
- `src/main/handlers/runner.ts` lines 278–382 (streaming stdout handler)
- `src/renderer/src/App.svelte` lines 231–333 (onStdout handler with signal prefixes)

**Recommendation:** 
Implement `run-chat` using the full `runner.ts` streaming pattern. Do not attempt to use `spawnClaudeJson`. Ensure that when `mode === 'chat'`, the projectFolder validation is skipped (already handled at line 72) and the run still sends output through the streaming `claude-stdout` IPC channel so signals reach the renderer in real-time.

---

## Question 2: [todo] signal from a chat run

**Finding:**

The `[todo]` signal handler has **zero dependencies on pipeline state** and will work correctly from a non-pipeline (chat) context.

**Signal processing flow:**
1. App.svelte `onStdout` handler receives line and checks for `TODO_PREFIX` match (line 316)
2. If match, extracts the text (line 317) and calls `projectStore.addTodo(text, undefined, priority)` (lines 327, 330)
3. `addTodo()` in `project.svelte.ts` (lines 98–108) is a pure state mutation:
   - Creates a new `TodoItem` with a random UUID, timestamp, and detected intent
   - Pushes it onto the `state.todos` array
   - No read of run state, gate state, pipeline mode, or any context-dependent value

**State mutations inside addTodo:**
- `crypto.randomUUID()` — no dependencies
- `agentId` parameter — optional, not used for chat
- `priority` parameter — passed in from the signal parser (architect format or bare format)
- `detectIntent(text)` — pure regex matching against INTENT_PREFIXES (lines 16–30), stateless
- Direct array push to `state.todos` — no guard clauses or conditional logic

**No context dependencies:**
- No check of `pipelineMode`, `testerMode`, `run.status`, `gate.isOpen`, or any runtime state
- No branching based on whether this is a pipeline run or a chat run
- No guards preventing todos from being added outside of pipelines

**Verdict:** Safe to emit `[todo]` from chat runs. The signal handler is completely stateless and will append the todo to the board without any conditional logic based on pipeline context.

**Source:**
- `src/renderer/src/App.svelte` lines 316–333 (signal parsing)
- `src/renderer/src/stores/project.svelte.ts` lines 98–108 (addTodo function)
- `src/renderer/src/stores/project.svelte.ts` lines 16–30 (detectIntent regex logic)

**Recommendation:**
The `[todo]` signal is safe to use from a chat run with no special handling required. No additional guards or context checks are needed in either the signal classifier or the store mutation.
