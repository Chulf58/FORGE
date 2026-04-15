# FORGE — Architecture Decisions

Non-obvious technical decisions made during development. Reference this when a similar question comes up again.

---

## [2026-04-15] Observer-primary over wrapper; wt.exe SessionStart hook for auto-split-pane

**Context:** This sprint delivered two parallel TUI surfaces for the FORGE dashboard: a **wrapper** (`scripts/forge-wrapper-proto.mjs`) that embeds Claude as a `node-pty` child, renders it via `@xterm/headless` into a blessed split-pane with the dashboard on the right, and carries all the complex PTY/render/mouse/quit code; and an **observer** (`scripts/forge-observer-proto.mjs`), a standalone full-screen blessed dashboard intended to run in a separate terminal pane next to native `claude`. Board tasks `24fae760` (TUI library evaluation) and `3438a2be` (wrapper-primary vs observer-primary) were both flagged as blocking. This entry settles `3438a2be`; `24fae760` consequentially simplifies.

**Decision:** The **observer** becomes the primary terminal-native FORGE surface. The **wrapper** is demoted to experimental/opt-in. Files remain on disk — no hard-delete in this slice. A SessionStart hook that calls `wt.exe -w 0 sp -V --size 0.35 -- <observer-launcher>` restores the wrapper's "one command starts both" UX without the wrapper's complexity.

**Reason:** The wrapper carries ~500 lines of hard complexity built this sprint: PTY management, `@xterm/headless` double terminal emulation, a hand-rolled ~60-line SGR cell-diff paint loop, raw stdin forwarding, SGR mouse reporting with the Shift+click-drag selection tradeoff, the opacity fix, a 500ms-SIGKILL quit path, and the `findClaude()` discovery chain. Every one of those exists to preserve a single user-facing UX: "one command starts Claude and the dashboard in one terminal window." Verified external evidence (`alex-radaev/claude-panel`, file `hooks/scripts/session-start.sh`) shows this same UX can be achieved via a ~15-line SessionStart hook that calls `wt.exe -w 0 sp -V --size 0.35 -- <command>` on Windows Terminal, with an `osascript` branch for iTerm2. ~500 lines of wrapper vs a 15-line hook plus a native-terminal split that has strictly better properties: native text selection (no `Shift` needed in Claude's pane), terminal-native pane resize, crash isolation between Claude and the dashboard.

**Consequences:**
- Next TUI feature work (clickable gate approve/discard, merge retry, drag-drop task reorder, pixel-art worker cards, token usage display) lands in the observer pane, not the wrapper.
- Task `24fae760` (TUI library) simplifies: without the wrapper's PTY embedding constraint, Ink becomes viable for the whole TUI surface. blessed/neo-blessed no longer mandatory.
- Shift+click-drag tradeoff is contained to the FORGE dashboard pane (where mouse UI lives anyway). Claude's own pane is owned by the terminal and keeps fully native selection regardless of any future mouse capture we add in the observer.
- `scripts/forge-wrapper-proto.mjs`, `bin/forge.js`, `bin/forge.cmd`, `scripts/forge-launcher-smoke-test.mjs`, and the wrapper-launcher generation inside `hooks/mcp-deps-install.js` all stay on disk during the transition phase. Hard-delete is a later cleanup slice once observer-primary is fully validated in daily use.

**Alternatives considered:**
- **Wrapper stays primary as-is** — rejected. The complexity cost is not justified by the UX delta vs a `wt.exe`-based hook.
- **Hard-delete wrapper now** — rejected. Observer+hook path not validated in daily use yet; wrapper stays as an escape hatch through the transition.
- **On-demand dashboard** (codeburn-style: user runs when curious) — rejected because worker sessions will live in the side panel and need to be visible during pipeline execution.

**Reference:** `alex-radaev/claude-panel` demonstrates the pattern in production. Their exact `wt.exe` invocation from `hooks/scripts/session-start.sh`:
```
wt.exe -w 0 sp -V --size 0.35 -- wsl.exe -d "$WSL_DISTRO_NAME" -- bash -lc "$CMD"
```
FORGE (native Windows, not WSL) drops the `wsl.exe` hop. Implementation follow-up is tracked on the board as a new high-priority task.

---

## [2026-04-10] Plugin as the distribution model (not Electron)

**Context:** FORGE started as an Electron desktop app. Distribution required building installers, managing Electron updates, and copying agent/hook/command files into every project. The plugin approach was explored as an alternative.

**Decision:** FORGE is now a pure Claude Code plugin. The Electron app at `C:\Users\cuj\Forge` is frozen and will not receive new features. All development happens in `C:\Users\cuj\forge-plugin`.

**Reason:** A plugin solves the three biggest friction points:
1. **Updates** — change once in the plugin, all projects get it. No re-scaffolding.
2. **Distribution** — team members install the plugin once. No Electron installer, no Node.js dependency.
3. **Maintenance** — no IPC boilerplate, no main/renderer/preload split, no build step.

**What stays:** All 28 agents, 17 commands, 5 hooks, 6 templates, the pipeline logic, the gate system, the signal protocol, the worktree system. The core of FORGE is unchanged — only the delivery mechanism changed.

**What's lost:** Visual UI (reactive sidebar, LIVE tab, gate bars, dashboards). These are deferred to an optional companion web dashboard (`forge-web-dashboard` in backlog).

**Trade-offs:** Plugin system is newer and less battle-tested than Electron. Per-project customization requires project-level `.claude/agents/` overrides. Team sharing requires each member to install the plugin (vs git-based scaffold sharing).

---

## [2026-04-10] MCP server for multi-model routing (pinned, not built)

**Context:** The user wants zero vendor lock-in — ability to route agents to different model providers (Anthropic, OpenAI, Google) based on cost/capability. The Electron app had a 37-task multi-engine epic. The plugin architecture makes this simpler.

**Decision:** Use a local MCP server bundled in the plugin (`mcp-server/index.js`) that routes agent calls to different providers based on a `forge-config.json` config file per project. Declared via `.mcp.json` in the plugin root. Claude Code spawns it automatically as a child process.

**Reason:** MCP is the standard protocol for Claude Code tool extensions. A local MCP server collapses the 37-task epic into ~3 components (server, provider adapters, config). Each provider adapter is ~20 lines. Works with multi-session/worktrees (each session spawns its own stateless instance).

**Status:** Architecture pinned for later. Not yet implemented. Default: everything runs on Claude natively. MCP server only activates when non-Anthropic routes are configured.

---

## [2026-04-10] Distribution via marketplace with local path

**Context:** The plugin needs to be distributable to a team without publishing to a public marketplace.

**Decision:** Create a marketplace wrapper repo containing the plugin. Team members install via:
```
claude plugin marketplace add <path-or-git-url>
claude plugin install forge
```
Updates via `claude plugin update forge`.

**Reason:** `claude plugin marketplace add` accepts local filesystem paths and git repos. No public marketplace needed. A simple install script (`install.bat`) can automate the clone + registration.

**Alternatives considered:**
- Direct local path install: Not supported by Claude Code — plugins must come from a registered marketplace.
- NPM package: Viable but adds build/publish overhead for an internal tool.
- Git clone to `~/.claude/plugins/`: Unclear if Claude Code scans this directory.

---

## [2026-04-10] Banner/logo display limitations

**Context:** Wanted to display a FORGE logo/banner when the plugin starts. Explored all hook-based approaches.

**Finding:** Claude Code's SessionStart hook stderr output gets wiped by the TUI on first render. PreToolUse stderr is swallowed entirely. No official Claude Code plugin displays a logo.

**Current state:** `forge-banner.js` exists as a SessionStart hook. It renders a braille flame + gradient FORGE text to stderr and injects `additionalContext` via stdout JSON. It has never been tested through the native plugin loading system — only as a standalone script.

**Decision:** Keep the banner script but don't invest more time until the plugin is loaded natively and we can verify what actually displays.

---

## [2026-04-10] Board cleanup — 89 Electron items removed

**Context:** The plugin inherited the Electron app's 132-todo + 6-planned board. Most items referenced Electron UI components, modals, tabs, and IPC patterns that don't exist in a plugin.

**Decision:** Removed 89 items in three categories:
- **Electron UI** (59): modals, gates, tabs, terminal rendering, Svelte components, One Chat UI bugs
- **Superseded by plugin** (12): scaffolding rethink, distribution, IPC drift, folder cleanup
- **Covered by MCP pin** (17): all multi-engine-* tasks collapsed into the MCP architecture decision

**Kept:** 48 todos + 1 planned — agent improvements, pipeline efficiency, knowledge compounding, and features that work identically in a plugin (git integration, test execution, project references, web dashboard).

---

## [2026-04-09] Brainstormer/Planner role split

**Context:** The planner agent was handling two distinct responsibilities: (1) asking clarifying questions about the intended feature via a `[questions]` signal, and (2) writing the sequenced plan. In runs where clarifying questions were necessary, this created a cognitive load that made plan synthesis harder — the agent had to context-switch between "what does the user actually want?" and "how should we build it?". Additionally, the `[questions]` signal logic was being duplicated in multiple agent prompts (planner, refactor, debug), making it hard to keep question quality consistent across modes.

**Decision:**
- Split into two agents: **Brainstormer** (new, owns clarification) and **Planner** (simplified, owns sequencing).
- **Brainstormer** runs conditionally before Planner. It classifies scope (trivial/small/large), asks 0–5 focused clarifying questions via `[questions]` signal, and writes a structured requirements document to `docs/brainstorms/<slug>.md` with YAML frontmatter (scope, questions asked, user answers, key assumptions).
- **Planner** is stateless — it reads the brainstorm doc if present, otherwise treats the input as fully specified, and writes the plan directly with no questions.
- **Orchestrator heuristic** controls when to invoke brainstormer: skip if the original input already contains acceptance criteria, specific file paths, or affected areas (signals the user has done the thinking). This avoids redundant clarification for well-specified tasks.
- Remove Q&A-before-approach logic from orchestrator (brainstormer now handles this).

**Alternatives considered:**
- Keep Q&A in planner, add a pre-planner phase that's just Q&A: Rejected — still adds latency (wait for user to answer questions before planner even starts). Separating the agents allows brainstormer to run fast and early, so answers are ready for planner.
- Make brainstormer a separate (non-gated) phase that always runs: Rejected — for well-scoped tasks (bug fixes, refactors with clear criteria), mandatory brainstorming adds overhead. Conditional skip on heuristics balances completeness with velocity.
- Keep Q&A distributed (planner, refactor, debug each ask independently): Rejected — inconsistent question quality and format across modes, hard to maintain. Centralized brainstormer allows a single authoritative definition of "good clarifying questions".

**Reason:** Separates concern: clarification is about understanding the *intent*, planning is about building the *sequence*. Single-purpose agents are easier to prompt, test, and iterate. Brainstormer output (requirements doc) becomes a reusable artifact for other agents downstream.

**Trade-offs:**
- Extra pipeline stage (plan feature now has brainstormer → planner → researcher): Accepted — brainstormer is fast and optional; skipped for well-specified tasks. Upside: planner focus improves, reusable requirements docs help subsequent cycles.
- Requires users to answer questions upfront if brainstormer runs: Accepted — clarifying questions are typically necessary anyway; surfacing them early prevents replanning later. Alternative (skip brainstormer) is available for urgent/tactical work.
- New file type (brainstorm docs) to manage: Accepted — docs are lightweight, YAML is familiar, and requirements become reusable knowledge in future projects.

---

## [2026-04-09] Block-based terminal streaming model

**Context:** Terminal output was being buffered line-by-line in the renderer, with signal extraction happening on each line independently. This meant the main process sent individual `claude-stdout` events for each line fragment, overwhelming IPC bandwidth and forcing the renderer to handle signal parsing for every text update. Additionally, the line model didn't match Claude's actual output structure — tool invocations and edits are multi-step events (tool_use → tool_result, unified diff across multiple events) that don't naturally decompose into lines.

**Decision:**
- Replace line-based streaming with a block-based model. Blocks are the unit of terminal output: `ContentBlock` (streamed text), `ToolBlock` (tool invocation + diff + result), `RunDividerBlock` (agent section boundary), `SystemBlock` (control/status messages), `TerminalBlock` (plain-text legacy compatibility).
- Main process batches claude chunks in 16ms intervals (reducing IPC event count by 10–30×) and emits `claude-chunk` events with a line buffer containing all buffered text. Signal extraction happens in the line buffer inside App.svelte's `onChunk()` handler — signals are stripped before the block is created.
- Three new IPC events replace scattered `claude-progress` handling: `claude-tool-open` (emitted when tool_use block arrives, before result), `claude-tool-diff` (emitted when unified diff is computed from tool input + edit spans), and `claude-tool-result` (result content, no change to this event).
- Session store maintains a `blocks` array (100-item cap, oldest blocks dropped as new ones arrive). Each block type is a discriminated union (`type: 'content' | 'tool' | 'divider' | 'system' | 'terminal'`).
- Terminal.svelte renders blocks in order, not lines. Tool blocks render as collapsible cards with diff visualization inline (no separate modal). Content blocks render as markdown paragraphs with agent labels and optional run grouping.

**Alternatives considered:**
- Keep line-based but optimize IPC batching (send 10 lines per event): Rejected — lines don't map to tool invocations, so even with batching, the renderer's signal extraction and block reconstruction logic remains complex. Blocks are the right abstraction.
- Emit a single `claude-done` event with all accumulated output as one blob: Rejected — streaming is essential for perceived responsiveness (user sees output as it happens). Buffering to end-of-run defeats the purpose of real-time feedback.
- Use a separate `diffEditor` component modal for tool edits (don't render inline): Rejected — inline diff keeps the conversation self-contained and lets users see context around the edit without modal navigation.
- Keep line persistence in session store for backward compatibility, render from blocks: Rejected — dual persistence (lines + blocks) is confusing and wastes memory. Store one abstraction; migrate legacy projects to load blocks from session files on disk.

**Reason:** Blocks match Claude's actual output structure (tool invocations, edits, content) and reduce IPC chatter by 10–30×. Signal extraction in the line buffer is simpler and more reliable than per-line detection. Inline diff rendering keeps the interface compact.

**Trade-offs:**
- Terminal rendering complexity increases: blocks are more complex than lines, but Terminal.svelte is now the only place that understands blocks. Store structure is simpler (no line type variants).
- Session persistence format changes: old session files with lines array will be silently migrated to blocks on load (backward-compat `loadHistory()` function). New sessions use blocks exclusively.
- Tool diff computation must happen in main process (iterative LCS diff): Accepted — diff is O(n) and happens once per tool_result; moving it to renderer would recompute on every render cycle.

---

## [2026-04-09] Orchestrator two-tier rules for pipeline governance

**Context:** The orchestrator (Sonnet one-chat session) needed governance rules to prevent runaway pipelines, self-looping recovery attempts, and agent set explosion in multi-stage chains. Previously, ad-hoc rules ("just do it", "don't emit [run-pipeline] without approval") were scattered in prompts and enforced by fragile regex patterns. As the orchestrator became more autonomous, the lack of clear tier-based rules led to scenarios where it would emit `[run-pipeline]` without user approval, or fail to escalate when blocked.

**Decision:**
- Introduce two-tier governance: **Tier 1** (always active) and **Tier 2** (activated only when blocked or loop count ≥ 2).
- **Tier 1 rules** (hardcoded in ORCHESTRATOR_RULES in shared.ts): respect project agents, keep responses brief, ask clarifying questions instead of guessing, propose workarounds before recommending feature requests, emit `[run-pipeline]` ONLY after explicit user approval, resume session (don't auto-advance) if rejected.
- **Tier 2 rules** (activated when loop count > 1 or BLOCK detected): emit `[suggest]` chip for human confirmation on plan modifications, defer architecture decisions until coder validates, reduce agent set (skip style/perf reviewers on loop 2+), recommend mode rollback (FULL → STANDARD) if blocked twice.
- Include loop-count state in system prompt so the orchestrator can reason about context and fatigue. Log all Tier 2 escalations to intent-log.jsonl for post-session review.

**Alternatives considered:**
- Single tier with permissive rules (always allow auto-advance, emit [run-pipeline] on plan approval): Rejected — leads to runaway chains where the orchestrator tries to "fix" reviewer blockers without human oversight.
- Three+ tiers with fine-grained conditions (loop count, token usage, model family): Rejected — too much state management; two tiers capture the essential distinction (normal vs. recovery).
- Hard block after 2 loops (refuse to continue): Rejected — this frustrates users who intentionally re-run to fix issues. Tier 2 descalation (skip reviewers, suggest chips) is better.
- Emit logs to a new logs panel in UI: Rejected — logs should be in files (intent-log.jsonl, HEALTH signals) for post-run analysis; real-time logging adds chrome without value.

**Reason:** Two-tier rules prevent runaway pipelines while allowing the orchestrator to recover gracefully from transient blockers. Tier 1 maintains baseline safety; Tier 2 enables recovery without exploding agent set or context usage.

**Trade-offs:**
- Orchestrator prompt becomes longer (100+ lines of tier rules): Accepted — rules are expressed declaratively, not buried in prose, making them easier to audit and update.
- Loop count must be tracked in context status and carried through session resume: Accepted — tracking is trivial (single integer); benefits (better recovery, auditability) outweigh the cost.
- Tier 2 escalation is heuristic-based (loop count ≥ 2, BLOCK detected): Accepted — heuristics are simple and predictable. User can always override via direct prompt (e.g. "skip reviewers and apply anyway").

---

## [2026-04-09] Q&A before approach generation in orchestrator (Real One Chat)

**Context:** The orchestrator was generating approach proposals directly from the user's initial prompt without first querying for clarification. This led to approaches that didn't match the user's actual intent, requiring multiple rejection cycles before a suitable plan emerged. Additionally, the orchestrator had no systematic way to discover missing constraints, platform considerations, or ambiguities in the task description before committing to a design.

**Decision:**
- Modify the orchestrator to emit a `[questions]...[/questions]` block BEFORE generating an approach proposal. Questions focus on: feasibility constraints, platform/environment specifics, existing patterns or dependencies, success criteria, and scope boundaries.
- Questions are optional (if the task description is unambiguous, the orchestrator can skip Q&A). However, when questions ARE asked, they are answered by the user before the orchestrator generates the approach.
- QaStrip.svelte displays the questions with toggle-able answer options (multiple choice or text) and a submit button. On submit, answers are appended to the session context as `User: [Q&A answers]` and the orchestrator resumes, now generating the approach with full information.
- This inverts the typical pipeline flow: instead of (approach → user rejection → revision), we have (Q&A → approach → likely approval on first try).

**Alternatives considered:**
- Always ask 3–5 fixed questions regardless of task clarity: Rejected — adds friction for trivial tasks. Questions should be optional and triggered by genuinely ambiguous scope.
- Generate two alternative approaches for the user to choose from: Rejected — more complex than Q&A; answers the "which approach?" question rather than eliminating the need for revision.
- Ask questions asynchronously (after approach is shown, user can request revision with answers): Rejected — this maintains the rejection cycle. Q&A-before is more efficient.
- Embed answers in the approach itself (e.g., "Assuming X, the approach is Y"): Rejected — hidden assumptions are error-prone. Explicit Q&A makes assumptions transparent.

**Reason:** Q&A before approach eliminates a round trip of rejection and revision for many tasks, shortening the path to a workable plan. It also makes user intent explicit in the conversation history.

**Trade-offs:**
- Additional IPC call (QaStrip → orchestrator resume) adds one network roundtrip: Accepted — this is negligible compared to the savings from avoiding revision loops.
- QaStrip UI complexity increases (answer options, toggles, submit): Accepted — QaStrip already handles questions generically; this is a new use case within existing chrome.
- Some users may skip Q&A or answer carelessly: Accepted — questions are optional and the user controls the session; if they skip, the result is their responsibility.

---

## [2026-04-09] Speculative coder during reviewer phase (LEAN/STANDARD modes)

**Context:** When the planner approves an approach, the pipeline enters the implement phase where the coder writes code, then reviewers (safety, logic, style, performance) validate. If reviewers block or request revisions, the coder re-runs on Loop 2+. This is correct but serial: the coder is idle while reviewers work. In LEAN and STANDARD modes (which use partial reviewer sets), there is capacity for parallel work.

**Decision:**
- Introduce a "speculative coder" that runs in parallel with reviewers during the implement phase. Once the first coder completes and handoff is written, immediately spawn a second coder instance (with `[revision-mode: speculative]` prefix) that reads the same handoff and proposes revisions speculatively.
- Speculative coder output is held (not merged) until reviewers complete. If reviewers block or request changes, the speculative output becomes the next Loop 2 coder iteration (saving one full coder run). If reviewers approve, the speculative output is discarded and we proceed to documenter.
- Speculative coder is enabled ONLY in LEAN and STANDARD modes (which have spare capacity). FULL mode disables it (all reviewers are already running, no spare capacity for speculation).
- Speculative coder uses the same handoff.md and coder-status.json context as the first coder, ensuring consistency.

**Alternatives considered:**
- Run speculative coder after reviewers complete (serial prediction of next revision): Rejected — this defeats the purpose (still adds latency). Parallel execution is the whole point.
- Run speculative coder in all modes (LEAN, STANDARD, FULL): Rejected — FULL mode already uses all 5 reviewers in parallel; adding speculative coder would overload context and token budget. Spare capacity only exists in LEAN/STANDARD.
- Always merge speculative output regardless of reviewer verdict: Rejected — this risks applying unwanted changes if reviewers approved the current iteration. Speculative is for Loop 2+, not primary approval path.
- Use a lightweight "diff-only" coder for speculation (read-once, grep-only, no full rewrites): Rejected — coder's reasoning is important for Loop 2 revisions; lightweight variants lose valuable context.

**Reason:** Speculative coder reduces expected latency in LEAN/STANDARD pipelines by 1 coder run (10–20% of total pipeline time) on average, without adding risk or complexity in FULL mode. The technique is proven in parallel systems (e.g., branch prediction in CPUs).

**Trade-offs:**
- Speculative coder context is duplicated (runs in parallel with reviewers, consuming tokens): Accepted — speculation happens only in LEAN/STANDARD with spare model capacity. Cost is amortized over the frequency of reviewer blockers.
- Speculative output may diverge from Loop 2 actual revision if coder reasoning changes: Accepted — speculative is a heuristic; if it diverges, it's discarded and a fresh coder run happens. No correctness lost.
- Requires careful orchestration of handoff timing (speculative must start after handoff is written): Accepted — handoff writing is deterministic (happens after first coder completes); orchestrator can trigger speculative at that point.

---

## [2026-04-09] Smart module assignment via LLM (Haiku-powered)

**Context:** When a planned feature does not fit into any existing module, the assign-module dialog previously required users to manually type a new module name. This was error-prone (typos, inconsistent naming) and required context-switching out of the planning flow. The planner could propose module names, but those were baked into the plan and hard to change without re-planning.

**Decision:**
- Implement LLM-powered module suggestion (Haiku) in the assign-module dialog. When the user clicks "Create New", the dialog spawns a Haiku agent with the feature name, description, and context of existing modules, and asks for a suggested module name (plus a 1-line description).
- Haiku responds with a suggested module name + description. The user can accept (applies to the feature and adds the new module to the registry) or edit (override the suggestion with a custom name).
- Smart assignment runs inline in the dialog (no modal chain, no external agent run). The result is persisted immediately to board.json + modules.json.
- This removes the need for planner to suggest modules (planner workflow stays unchanged); it shifts the suggestion responsibility to the moment the user needs it.

**Alternatives considered:**
- Have planner always suggest a module name in the approach: Rejected — this bakes the suggestion into the plan and makes it hard to change. Suggestion should be deferred to assign time.
- Offer a dropdown of existing modules only (no "Create New" option): Rejected — this forces features into mismatched modules or leaves them unassigned. Smart creation is better than forcing fit.
- Use vector similarity to suggest the closest existing module automatically (no Haiku): Rejected — similarity can be high even when the module is a poor semantic fit. LLM reasoning is more reliable.
- Store suggested module names in a separate config file (persist across sessions): Rejected — module registry (modules.json) is the single source of truth. Persisting suggestions elsewhere creates duplication.

**Reason:** Smart assignment shifts naming responsibility from the user to the LLM, reducing friction in the planning flow. Haiku's context-aware suggestions are more likely to align with the project's naming conventions than user free-typing.

**Trade-offs:**
- Adding a Haiku call in the UI adds latency (1–2s) to the assign-module dialog: Accepted — this latency is perceived as "the system is thinking" (normal in modern UIs) and is paid only when the user chooses to create a new module (common in new projects, rare in mature ones).
- Haiku's suggestions may not match the user's intent: Accepted — user can always override. The suggestion is a starting point, not a mandate.
- Smart assignment requires network access (Haiku invocation): Accepted — FORGE already requires Claude CLI for pipelines; this is one additional lightweight call per project.

---

## [2026-04-08] Terminal semantic density and agent-based grouping

**Context:** The terminal was displaying all output (agent lines, work lines, tool calls) in a flat time-series stream. This is correct chronologically but makes it hard to follow what each agent is doing, especially during parallel work. Users had to scan line-by-line to understand agent identity and progress. Additionally, tool output (10+ lines per tool call result) dominated the terminal's vertical space, pushing user-visible prose off-screen quickly.

**Decision:**
- Group all terminal lines by agent identity (`agentGroup` field on TerminalLine, RunSummaryLine, and all append functions). Terminal.svelte renders agent sections with visual headers and optional collapse/expand state. When a new agent begins output, that starts a new section; same agent lines continue the current section.
- Reduce line density for tool output (changed from default line-height to 1.3x, 10px vertical spacing) to make tool results scannable without wasting space. This is a "semantic density" optimization — tool output has high information density (stack traces, file lists, JSON) so tighter spacing aids parsing.
- Add a progress bar during tool calls showing tool name and estimated progress (if available). This communicates to the user that the agent is working and what it's working on, reducing perceived latency.
- Move run-summary (file operations, token count) to the end of the terminal, after all agent output, rather than mixing it with prose. This lets users focus on agent work first, then review the summary.

**Alternatives considered:**
- Keep flat time-series but add agent identity prefixes on each line (e.g. `[coder]`): Rejected — prefixes add visual clutter and don't reduce scrolling load. Grouping is more readable.
- Add separate "Agent Timeline" sidebar showing per-agent progress: Rejected — adds complexity and new chrome. Terminal grouping is sufficient and keeps the conversation self-contained.
- Full-density tool output (normal line-height): Rejected — tool results (stack traces, file lists) become hard to scan visually; users miss important context. Tighter spacing matches the information density of the content.
- Keep run-summary inline with agent output: Rejected — metrics are metadata that distract from the main narrative. End-of-run placement lets the user focus first, review stats last.

**Reason:** Agent-based grouping + semantic density makes the terminal faster to scan and understand. Users can see at a glance what each agent did, in what order, without counting lines. Progress bars reduce perceived waiting time during tool calls.

**Trade-offs:**
- Terminal rendering becomes more complex (agent section boundaries, collapse/expand state, progress bar lifecycle): Accepted — complexity is isolated to Terminal.svelte component logic; store structure remains simple (just agentGroup field).
- Collapse/expand state per agent section requires UI interaction: Accepted — interactions are optional; users can expand only the agents they care about. Sections default to expanded so first-time users see everything.
- Semantic density trade-off: tool output is more compact but may be harder for users unfamiliar with stack traces or JSON to parse: Accepted — this is a pro-user choice for power users (FORGE's primary audience); verbose spacing can be re-enabled if user feedback warrants.

---

## [2026-04-07] Structured tool call rendering in terminal (glass wall)

**Context:** The terminal displays Claude's work as a stream of text — normally this works well for inline progress (dimmed work lines, prose in one-chat mode). However, tool calls are opaque to the user: they see only the tool name and parameters as a flat `· claude-computer-use` line. This loses transparency about what tools the agent is invoking and what they returned. Additionally, multi-line tool results (e.g., a file listing, code snippet, API response) don't have a natural place in the line stream without bloating the terminal with unread content.

**Decision:**
- Introduce a new `ToolCallLine` type in the session store (separate from text lines). Tool calls are now first-class terminal objects with: tool name, category (computer-use / command-line / file / web / etc), parameters, tool use ID, result content placeholder, and expanded/collapsed state.
- Extend App.svelte's `onProgress` handler to create structured `ToolCallLine` objects instead of flat text. This requires parsing the tool name from Claude's internal `ContentBlockDelta` events (which do not expose structured data directly — tool use blocks arrive as opaque deltas).
- Add new `claude-tool-result` IPC event: when the runner receives Claude's `tool_result` content block, it forwards the result content to the renderer (capped at 5KB to prevent memory bloat). App.svelte's `onToolResult` listener matches the tool use ID and populates the result on the corresponding `ToolCallLine`.
- Terminal.svelte renders tool calls as collapsible cards: icon (category-specific emoji), tool name in blue (live, not dimmed), parameter summary, and an expandable result preview block (max 300px with scroll).
- Result truncation: if result exceeds 5KB, show a truncation notice at the end so the user knows they're not seeing the full output.

**Alternatives considered:**
- Keep tool calls as flat text but add result inline below (no collapsible state): Rejected — inline results bloat the terminal and force users to scroll past tool output to get back to prose. Collapsibility is essential.
- Emit tool results as terminal lines (append them naturally after the tool call line): Rejected — this makes the terminal harder to scan; prose and work lines mix, reducing visual parsing speed. Structured card + collapse is clearer.
- Store full result content without capping (no 5KB limit): Rejected — a large API response or file listing can consume 100KB+; storing unbounded results in the session store leads to memory bloat and slow re-renders. 5KB captures intent (what the tool returned), which is what users care about for transparency.
- Expose tool results as a separate panel (not inline in terminal): Rejected — this adds chrome and requires modal/drawer; inline is faster and keeps the conversation self-contained.

**Reason:** Tool calls and results are core to understanding agent work. Making them structured and collapsible lets users follow the agent's reasoning without sacrificing terminal readability. The 5KB cap balances transparency with performance.

**Trade-offs:**
- Parsing tool calls from opaque deltas requires regex or heuristics on the tool name (Claude does not expose structured tool_use events to progress handlers): Accepted — tool names are short and predictable (e.g. `claude-computer-use`, `command-line-tools`, `file-search`), and regex is reliable.
- Tool results are capped and may be truncated: Accepted — the goal is transparency about *what happened*, not full reproducibility of output. Users can re-run the tool or check the project folder if they need the complete result.
- New IPC event requires 4-location wiring (handler, preload, types, ipc wrapper): Accepted — this is the standard FORGE pattern and ensures type safety end-to-end.
- Terminal.svelte CSS and rendering logic becomes more complex (collapsible state, scroll regions, truncation logic): Accepted — complexity is isolated to Terminal.svelte; the store and App logic remain simple.

---

## [2026-04-07] Pipeline boundary rules in orchestrator system prompt

**Context:** One Chat's orchestrator needs to decide which pipeline to recommend (direct, sprint, plan feature, debug, refactor) for a given task. Previously, the orchestrator had no explicit rules for this decision — it relied on its training (which may be stale or inconsistent with FORGE's current constraints). Additionally, task descriptions often don't mention whether they cross IPC boundaries or add reactive state, making the decision opaque to the user.

**Decision:**
- Document explicit pipeline selection criteria in `ORCHESTRATOR_RULES` (in shared.ts) and inject them into the orchestrator's system prompt on every one-chat session. Rules include:
  - `direct` = single file, no type propagation, no cross-file changes
  - `sprint` = multiple files, no new IPC channels, no reactive state (`$state`, `$derived`, `$effect`), no Svelte components
  - `plan feature` = required when: new IPC channel, reactive state added, new/modified Svelte component, type propagation across layers
  - `debug` = broken or regressed behaviour (bug fix)
  - `refactor` = cleanup, renaming, or simplification of existing code
- Provide supporting detail: examples of tasks that fit each category, and common pitfalls (e.g. "adding a function to existing file = sprint, but adding an effect that calls that function = plan feature because of reactive state").
- Rules are read-only for the orchestrator (it must not modify them); they serve as reference logic, not configurable gates.

**Alternatives considered:**
- Hard-code the pipeline selection in App logic (switch statement on task keywords): Rejected — this removes the agent's reasoning and makes updates brittle. Orchestrator can read rules and explain its decision naturally.
- Provide rules as a separate reference document (not injected into system prompt): Rejected — orchestrator would not see them unless the user explicitly shares the document. Injection ensures they're always in scope.
- Let orchestrator learn pipeline boundaries from past examples (few-shot prompting): Rejected — FORGE's pipeline rules are precise and canonical; they should not be learned heuristically. Explicit injection is more reliable.
- Make rules configurable per project (allow users to override pipeline selection): Rejected — this adds complexity and allows misconfiguration. FORGE's rules are sound and should apply universally.

**Reason:** Orchestrator decisions should be transparent and grounded in explicit constraints, not hidden in training. By injecting rules into the system prompt, the orchestrator can explain its reasoning (e.g., "this task requires plan feature because it adds a new IPC channel"), and users can understand why a pipeline was selected.

**Trade-offs:**
- Rules add ~1KB to the system prompt (injected on every one-chat session): Accepted — 1KB is negligible; clarity is worth it.
- Orchestrator is bound by the injected rules (cannot adapt to edge cases): Accepted — edge cases are rare; if a task truly doesn't fit, the user can override manually. Canonical rules are preferable to ad-hoc exceptions.
- Rules are read-only (orchestrator cannot propose new rules): Accepted — rule evolution happens via FORGE development, not user customization. This keeps the system predictable.

---

## [2026-04-07] Orchestrator replaces intent classifier; pipeline handoff via signal (Real One Chat)

**Context:** FORGE's One Chat mode used a Haiku classifier to route natural-language prompts to specific pipeline types and modes, then required a two-step confirmation (Enter to classify, then Enter again to approve, with intent preview in between). This added friction and latency. Additionally, the two-step flow split the conversation: Haiku is strictly a classifier (no context memory), while the user's request lives in the prompt bar until execution.

Real One Chat aims to merge these into a single conversational session where the user talks to an agent that understands context, can ask clarifying questions, and proposes approaches before acting.

**Decision:** 
- Replace the Haiku classifier with a continuous Sonnet orchestrator session (invoked once with `--resume` on each user prompt).
- Orchestrator is stateless to Haiku (no intent classifier call) but receives rich context: current project state, available pipelines, and `ORCHESTRATOR_RULES` system prompt that instructs it to be conversational, propose approaches, and emit a new `[run-pipeline]` signal when the user approves.
- When the orchestrator proposes an approach and the user approves, it emits `[run-pipeline] <type> | <mode> | <original-prompt>`. The App catches this signal, saves handoff details, stops the orchestrator session, and chains to `triggerRun()` to start the full-agent pipeline with complete agent injection (~240KB context).
- One-chat mode skips agent injection entirely (~34KB total): only GENERAL.md, SKILLS.md, and ORCHESTRATOR_RULES are sent. This keeps conversation context small and fast.
- PromptBar simplified: single Enter submits and resumes the session. No two-step flow, no intent preview, no IntentConfirmRow.

**Alternatives considered:**
- Keep Haiku classifier but cache its response across multiple prompts: Rejected — Haiku is still strictly a classifier (no dialogue mode); caching doesn't solve the two-step friction. The user would still see classify → preview → confirm.
- Extend orchestrator to optionally emit structured intent (instead of free-form signal) so App can infer type and mode: Rejected — forcing the orchestrator to output JSON breaks conversational tone; signals are unobtrusive and let the orchestrator speak naturally.
- Run full-agent injection in one-chat mode so pipelines can fire without handoff: Rejected — 240KB context at every prompt turns conversations sluggish; users want fast back-and-forth and only need heavy agents when executing.
- Keep two-step flow but remove Haiku (orchestrator proposes, user approves, orchestrator executes): Rejected — this removes the gate and loses transparency. The pipeline (planner, reviewer) gates are what give users final agency; orchestrator should stay conversational and lightweight.

**Reason:** One Chat is defined by a single conversational agent that understands context and proposes work rather than a classifier that routes to hidden pipelines. Orchestrator + signal-based handoff preserves transparency (gates stay on the board) while unifying the UX into one continuous conversation.

**Trade-offs:**
- Orchestrator has no access to past messages (sessions are ephemeral, each prompt resumes fresh): Accepted — this keeps memory bounded and prevents unbounded context growth; brief context window is acceptable for conversational routing and proposal.
- Signal-based handoff requires App to parse and act on signals (previously only used for internal flags like `[tester-gate]`): Accepted — signals are a proven pattern in FORGE; new signal adds no complexity beyond existing post-tool-hook and onStdout handlers.
- Removing agent injection from one-chat means orchestrator cannot detect or emit detailed health signals (health analysis needs full project scanning by agent): Accepted — one-chat focuses on guidance and proposal; health signals are for pipelines to emit after execution.
- Users lose the live agent card preview from one-chat: Accepted — preview was useful mainly to verify intent classification; orchestrator's conversational proposal is clearer than abstract agent cards.

---

## [2026-04-07] Gate bars and buttons as conversational elements (Phase 3: dialogue UX)

**Context:** Gates were originally rendered as full-width chrome bars with all-caps button labels and tinted backgrounds, positioning them as system UI overlays separate from the terminal content. As FORGE moves toward One Chat (gates as part of the conversation flow), gates needed to feel integrated into the agent dialogue, not distinct UI fixtures. Additionally, button styling (bordered chips) did not match natural language interaction patterns.

**Decision:** Render gate cards as agent messages within the terminal scroll:
- Left accent border (2px, colored per agent: blue for planner, red for reviewer) replaces full-width chrome
- Agent prefix (`planner ▸`, `reviewer ▸`) added to gate heading so gates inherit agent identity from the conversation context
- Button labels changed from all-caps bordered chips (`→ IMPLEMENT`, `DISCARD`, `→ APPLY`) to underlined link-style text (`→ implement`, `discard`, `→ apply`)
- Gate heading label changed from `APPROACH` to `key decisions` (lowercase, more conversational)
- Gate inset margin adjusted so cards sit flush with terminal padding rather than extending full width
- Components stay mounted during collapse (not conditionally unmounted) to preserve state and keep visual stability during layout transitions

**Alternatives considered:**
- Keep gates as full-width chrome but add agent label: Rejected — chrome UI implies a separate layer; the accent-border + prefix approach signals integration more clearly.
- Add background tint but reduce contrast: Rejected — even reduced tint reads as "modal overlay"; the accent border is sufficient for visual separation.
- Unmount gate components when RightPanel collapses: Rejected — Haiku + LivePanel agent cards maintain internal scroll state; remounting them would lose user's scroll position.
- Use sentence case for buttons but keep bordered chips: Rejected — bordered chips are a design pattern for system actions; underlined links better match conversational tone.

**Reason:** Gates are now first-class participants in the conversation flow (an agent message, not system chrome), so their visual style and language should match the agent voice already established in the terminal.

**Trade-offs:**
- Accent-border design requires careful color contrast tuning for both light and dark modes: Accepted — color already defined per-agent in AGENT_META.
- Mounting components permanently instead of conditionally adds slight memory overhead in RightPanel collapse: Accepted — overhead is negligible (a few Svelte component instances); preserved state improves UX by keeping scroll position.
- Link-style buttons have no visual border, may be less discoverable for users unfamiliar with underline convention: Accepted — underlines are a standard web convention for clickable links; tooltip/testing can clarify discoverability.

---

## [2026-04-07] Imperative-verb pre-screen for intent classification (misclassification fix)

**Context:** Haiku's intent classifier (natural-language routing to pipeline type and mode) shows a bias: short imperative prompts without question marks (e.g., "add dark mode") are often misclassified as chat requests instead of feature requests. This is a known Haiku pattern — it tends to default to safe, conversational responses when uncertain. The existing word-count pre-screen (>20 words, no `?` → `plan feature`) does not catch short feature requests.

**Decision:** Add an imperative-verb pre-screen before the Haiku call. Check if the prompt starts with an action verb (`add`, `create`, `build`, `fix`, `update`, `implement`, `remove`, `refactor`, `optimize`, `improve`, etc.) and contains no `?`. If so, return `plan feature` immediately without invoking Haiku. This complements the word-count screen and catches the most common misclassification pattern.

**Alternatives considered:**
- Train Haiku with a few-shot prompt to prefer feature classification: Rejected — Haiku lacks sufficient reasoning for reliable few-shot retuning; the bias is structural to the model.
- Expand the word-count threshold to capture short imperatives: Rejected — threshold-based routing is brittle; prompt "add mode support" (3 words, no `?`) should still trigger plan-feature, but arbitrary word limits fail.
- Post-hoc reclassification: ask Haiku for confidence score, re-prompt on low confidence: Rejected — adds extra latency and requires new IPC; the verb-based screen is simpler and catches >90% of short imperative cases.
- Append `?` detection: if user didn't add a `?`, assume chat intent unless they used an imperative verb: Rejected — this is exactly what the verb-screen implements.

**Reason:** Imperative verbs are reliable intent signals for feature requests; short features without `?` are genuinely ambiguous in natural language, so a fast heuristic is safer than trying to make Haiku more confident.

**Trade-offs:**
- Pre-screen must maintain a list of action verbs; new verbs cannot be added without code change: Accepted — the verb list is stable (add, create, build, fix, update, implement, remove, refactor, optimize, improve, enable, disable, and synonyms); new verbs are rare, and edge cases fall back to Haiku.
- A user typing "add light" (fragment, not English) will falsely trigger plan-feature; could be a clarifying question: Accepted — false positives for plan-feature are low-cost (user sees gate, can discard); false negatives (misclassified as chat) are worse because they trap work in chat history.
- Haiku pre-screen adds computational cost; trades context tokens for early return: Accepted — parse overhead is ~1ms per prompt; savings on skipped Haiku calls outweigh parse cost by >100×.

---

## [2026-04-07] Board consolidation: merge duplicate epics, defer premature multi-engine tasks to backlog

**Context:** FORGE's task board accumulated redundant epics (git-integration and provider-model-config as separate tracked items), scattered multi-engine orchestrator work across Phase B and C with no clear priority order, and kept stale Phase A tasks (agent-skills-audit, docs-folder-consolidation) whose scope had shifted. The board had grown to 60+ items with unclear value sequence, making it hard to reason about what to build next.

**Decision:**
- Identify and **merge duplicate epics** into single source of truth (git-integration now contains 5 consolidated tasks; onboarding-epic now owns 4 parts). Delete the redundant singleton tasks (provider-model-config, multi-engine-orchestrator-decouple).
- **Defer 13 Phase B/C multi-engine tasks to low priority** (tag: `deferred`, priority: low). These represent greenfield work (multi-LLM fallback, model routing, external agents) that cannot ship until Phase A core gates and reliability features land. Move them to Backlog so they don't clutter the active plan.
- **Trim Phase A to 4 core tasks** (signal telemetry, gate interaction, project validation, agent safe mode). Phase A now represents a clear 2-week sprint toward reliability and observability, not a wish list.
- **Revive stale tasks with updated scope:** agent-skills-audit (now scoped to 3 specific agents), docs-folder-consolidation (now scoped to code-project templates only), dynamic-pipeline-construction (now a single feature, not epic).

**Alternatives considered:**
- Archive Phase B/C to a separate backlog file: Rejected — archive should be completed items only (PLAN-archive.md); future work lives in either PLAN.md (active) or BACKLOG.md (queued). Moving to BACKLOG.md is cleaner.
- Keep all items in PLAN.md but mark them `[ ]` (not started) and sort by priority: Rejected — mixing completed, active, and deferred items in one file reduces clarity; three separate files (PLAN, BACKLOG, archive) establish a clear state machine.
- Merge epics at implementation time (when coder picks up the work): Rejected — merging at planning time surfaces redundancy early and lets planner think through dependencies before coder is blocked.

**Reason:** A lean active plan focuses team energy on a clear 2-week sprint. Deferred but documented work in BACKLOG remains discoverable without cluttering the active roadmap.

**Trade-offs:**
- Moved items are no longer in PLAN.md so they don't auto-surface in orchestrator snapshots: Accepted — deferred items are not ready to propose anyway; orchestrator snapshots use active PLAN.md only.
- Merging epics requires manual resolution of duplicated sub-tasks (e.g., "add git CLI support" mentioned in both epics): Accepted — manual review catches semantic duplication that a simple name-match merge would miss.
- Phase A scope is tighter, meaning some valuable work (multi-LLM fallback) is further out: Accepted — this is a prioritization call, not a plan-and-defer bug; deferring greenfield work to focus on reliability is the right trade-off.

---

## [2026-04-07] Feature value audit: observe and merge observer+auditor agents, defer TDD and tester, quarantine dead visualiser

**Context:** FORGE runs 18+ pipeline agents, but not all carry their weight. Observer (telemetry agent) has become redundant with tool-call-auditor (which already logs every tool invocation for audit). Tester (unit test generation) runs optionally but is rarely enabled and requires state serialization—value is unclear. TDD agent (test-driven code generation) is speculative. Pipeline visualiser (attempt at visual DAG rendering) is dead code (no imports, orphaned). This session identified 6 simplification candidates; implementation is deferred but worth documenting the reasoning.

**Decision:**
- **Merge observer and tool-call-auditor:** Create a single unified quality agent (working name: quality-auditor) that owns both telemetry collection (existing tool-call-auditor function) and runtime performance observation (observer's current role). Store configuration in a new section of .pipeline/board.json (agent-automation). Log: `[audit]` and `[observe]` signals use the same handler.
- **Defer TDD agent to a separate test-loop orchestrator:** TDD's value depends on a test-execution loop that doesn't exist yet (test runner orchestration is a separate feature). Park TDD with a note for when test loops ship. Create task: test-execution-orchestrator.
- **Disable tester (keep skipTester flag):** Tester's state serialization cost outweighs its value in current pipelines. Keep the skip-tester toggle for future A/B testing if state serialization is revisited. No change to code—just update board note.
- **Quarantine PipelineVisualiser.svelte:** Move to .quarantine/ with delete date 2026-05-07. It was an experiment in visual DAG rendering; no longer relevant to the text-based gate UX.

**Alternatives considered:**
- Keep both observer and tool-call-auditor but refactor for minimal overlap: Rejected — they are observing the same tool invocations; two agents is a maintenance tax for no user-visible benefit.
- Implement test execution loop now to unblock TDD: Rejected — test-loop design is a full feature, not a small task; defer it to Phase C when test agents are prioritized.
- Delete tester agent entirely: Rejected — skipping is better than deleting; future users might want to re-enable it once state serialization is optimized, and the skip-toggle costs nothing.
- Delete PipelineVisualiser immediately: Rejected — quarantine with a grace period allows recovery if the UX design shifts back toward DAG visualization.

**Reason:** Agent portfolio should reflect actual value delivered. Observer+auditor merge consolidates observation responsibility; TDD deferral unblocks work by acknowledging async dependencies; tester and visualiser are parked in low-cost states (skip flag, quarantine folder) rather than carried forward indefinitely.

**Trade-offs:**
- Merging observer and auditor loses separate signal namespaces (observer's [observe] signal is now unified with auditor): Accepted — unified signal reduces signal parsing complexity; separate signals were never used for routing.
- Parking TDD without a test-execution orchestrator means TDD code stays in codebase doing nothing: Accepted — dead code is lower-cost than working code that can't be invoked; implement test orchestrator as a prerequisite task.
- Disabling tester means users cannot currently generate unit tests in pipelines: Accepted — tester's value is speculative anyway; re-enable when state serialization is faster or when projects explicitly request it.
- Quarantine adds .quarantine/ folder to the repo; deletion grace period adds file-maintenance overhead: Accepted — grace period prevents accidental recovery confusion; .quarantine/ is documented in recovery procedures.

---

## [2026-04-07] Three-tier TODO enrichment settings (Light/Standard/Full) for orchestrator context flexibility

**Context:** FORGE's orchestrator works best when aware of current project state, but injecting full TODOs can add 5–15k tokens, making one-chat conversations sluggish. Different users have different needs: some want rapid fire conversations with minimal context, others want rich task descriptions to inform proposals. A one-size-fits-all approach either bloats every prompt or starves the orchestrator of key context.

**Decision:** Add a user-facing enrichment level setting (Light/Standard/Full) in Settings GENERAL tab, backed by 3 tier prompts in the `enrich-todo` handler:
- **Light:** No enrichment; raw TODO text only (tokens saved: ~50% of full TODO context)
- **Standard:** Task description + assignee + labels (tokens saved: ~30%)
- **Full:** Complete task, including context, dependencies, and notes (maximum context, slowest)
Runner injects `ENRICH LEVEL: <tier>` into ORCHESTRATOR_RULES for one-chat mode; implementer passes enrichLevel through pipeline-data to `enrich-todo` handler. This lets users dial context up/down based on their conversation style.

**Alternatives considered:**
- Auto-detect enrichment based on conversation length (short sessions → Light, ongoing → Standard): Rejected — adds heuristic logic that may surprise users; explicit setting is transparent and gives control.
- Use project complexity signal (module count, file count) to auto-set tier: Rejected — complexity does not reliably predict user preference; a simple project might still want full context, and a complex one might want speed.
- Always use Standard as a compromise: Rejected — loses optionality for both power users (who want Full) and rapid-fire explorers (who want Light).
- Store enrichment in project.json instead of session settings: Rejected — enrichment is a user preference (session-level), not a project policy.

**Reason:** Enrichment is a trade-off between context richness and response latency; different users make that trade-off differently, so it should be user-facing and explicit.

**Trade-offs:**
- Three-tier system adds complexity to settings UI and enrich-todo handler: Accepted — complexity is localized to two places; the benefit (user control) justifies it.
- Users must understand the latency/context trade-off to set enrichment level appropriately: Accepted — tooltip and short description in settings clarify the choice; default is Standard (middle ground).
- enrich-todo handler must maintain three distinct prompts; changes to enrichment logic must be replicated across tiers: Accepted — three prompts are simple enough that maintenance cost is negligible.

---

## [2026-04-07] Quarantine stale files instead of deleting; archive folder with delete date and recovery instructions (project cleanup)

**Context:** FORGE has accumulated dead code as features evolved: old UI components (ModeRow, IntentConfirmRow), obsolete docs (FLOW.md, PIPELINE-ARCHITECTURE.md, BACKLOG.md), test stubs, and preload types from iterations ago. Deleting these files directly risks losing valuable code if a design decision is revisited. Additionally, reviewers occasionally reference historical decisions in old files, and hard deletes make that reference invalid.

**Decision:** Instead of deleting, move stale files to `.quarantine/` with a README that lists each file, why it was quarantined, and a target delete date (30 days out). This gives a grace period for recovery and documentation of what was removed and why. Intent handler deregistration in index.ts and dead imports are removed immediately (these are definitely stale), but source files and docs are quarantined. RECOVERY-POINTS.md is created with procedures for un-quarantining any file if a design pivot requires it.

**Alternatives considered:**
- Branch-and-tag strategy: create a git tag before deleting, so code is preserved in history: Rejected — still requires finding and checking out the tag; a local quarantine folder is more discoverable.
- Soft-delete via .gitignore: move files to .quarantine but leave old paths in use: Rejected — creates confusion about which version is "live"; clean removal from index.ts is clearer.
- Hard delete with commit message reference: Rejected — commit messages are not easily searchable; quarantine folder is discoverable via file browser and documents rationale inline.
- Archive to git branch instead of folder: Rejected — requires switching branches; a folder is faster to browse and recover from.

**Reason:** Quarantine is a middle ground between permanent deletion and cluttered source: it removes dead code from the active working set while preserving it for archaeology and recovery if needed.

**Trade-offs:**
- `.quarantine/` folder and its contents must be monitored and deleted on schedule (2026-04-21): Accepted — delete date is explicit in README; a calendar reminder or CI check can enforce it.
- Quarantine takes up disk space; the 31 quarantined files total ~150KB: Accepted — negligible overhead.
- Users unfamiliar with the quarantine strategy may try to import quarantined files; README must be clear: Accepted — README is explicit that quarantined code is not meant to be used.

---

## [2026-04-07] Split FORGE-OVERVIEW into narrative (overview) and reference (generated); add recipe for keeping them in sync

**Context:** FORGE-OVERVIEW.md had grown to 1363 lines, mixing narrative (eras, vision, what's next) with reference (module list, file map). Narrative reads beautifully when concise, but reference details are better auto-generated from source files to avoid drift. A single 1300-line doc required manual updates to both sections, and changes to modules.json had to be manually synced back to the doc.

**Decision:** Split into three files:
1. **FORGE-OVERVIEW.md** — Narrative only (Era entries, vision statement, "What's planned next" high-level bullets, key milestones). Trimmed from 1363 → 580 lines.
2. **FORGE-REFERENCE.md** — Auto-generated (665 lines) from source-of-truth files (board.json, modules.json, constants.ts, PLAN.md headers). Updated manually when boards change; includes module list with capabilities, pipeline overview, file map, and signal reference.
3. **FORGE-OVERVIEW-RECIPE.md** — Instructions for updating overview (when to add new Era, when to fold planned items into shipped), updating reference (refresh modules from modules.json), and updating the deck (Era slides and "Upcoming" section in FORGE-PRESENTATION.html).

This decouples narrative polish (subjective, edited for tone) from reference accuracy (objective, derived from source files).

**Alternatives considered:**
- Keep single monolithic file but use a "last sync date" comment: Rejected — does not solve the drift problem; sync date requires manual discipline, and 1300-line file is still unwieldy.
- Auto-generate entire overview from comments in code: Rejected — narrative (vision, eras, planning notes) is not in code; code comments are for implementation details, not strategy.
- Create separate files but no recipe: Rejected — without clear update procedures, reference drifts immediately.
- Generate reference on-the-fly as a view in the app: Rejected — not useful for external readers (GitHub, docs sites); static generated file is more portable.

**Reason:** Separating narrative and reference eliminates sync friction: narrative stays focused on strategy and vision, while reference is always fresh because it's generated from the source of truth.

**Trade-offs:**
- Two files instead of one adds surface area for confusion about which file is current: Accepted — clearly-marked "narrative only" and "generated" labels make the purpose obvious.
- Generated reference still requires manual update when boards change; it's not truly auto-generated at build time: Accepted — reference update is simple copy-paste from modules.json; automation could be added later if this becomes a bottleneck.
- Recipe adds one more doc to read when making strategic changes: Accepted — recipe is short and reduces cognitive load by explicitly stating when and how to update each file.

---

## [2026-04-06] Coder-scout pre-step: Haiku reconnaissance-only agent before the main coder in implement pipelines

**Context:** The coder agent in implement pipelines reads the full PLAN.md, full source files, and full researcher findings (which can exceed 50k tokens in complex projects). This overhead is paid even when the plan's active tasks affect only 2–3 files. The tier-based routing system (Haiku for tier-a bug fixes) cannot launch Haiku if every tier-a task still requires a full 50k-token context just to understand the scope.

**Decision:** Insert a new coder-scout agent (Haiku, max 3k tokens output) before the main coder in LEAN/STANDARD/FULL modes. Scout reads only active `[ ]` PLAN.md tasks (no function bodies), resolves file paths via Grep, and writes a compact scout.json: `{ files_to_read, functions_to_modify, new_files, ipc_channels }` (max 5 files). The main coder then reads scout.json and limits file reads to the listed set. Skipped in SPRINT/TRIVIAL modes to avoid extra IPC latency for already-simple tasks.

**Alternatives considered:**
- Coder reads PLAN.md on-demand with fuzzy matching: Rejected — coder cannot distinguish whether a task description refers to a file path or just mentions a file name; Grep is safer and faster.
- Skip context reduction, accept 50k baseline: Rejected — tier-a routing becomes unviable; Haiku context budget exhausted before even starting implementation.
- Scout generates a full module map (names, purposes, key functions): Rejected — too much work for Haiku; scout's job is scope detection, not architecture analysis.
- Scout embedded inside coder (conditional first-pass): Rejected — mixing scout and coder logic creates branching complexity and makes revision loops harder to reason about.

**Reason:** Scout decouples scope detection (Haiku, 2–3 min) from implementation (Haiku or Sonnet, 5–15 min), allowing tier-a tasks to stay on Haiku without paying full-context overhead.

**Trade-offs:**
- Extra IPC invocation and 2–3 minutes latency per implement run (scout is mandatory in LEAN+): Accepted — net savings on tier-a (Haiku cost ~10 tokens) + tier-b/c (Sonnet routed correctly via [tier]) outweigh the scout overhead across multiple runs.
- Scout may miss edge cases when a task refers to a file only indirectly: Accepted — scout is a heuristic; coder fixes scout omissions on first revision, and [revision-mode] skip rereads avoid duplicate context.
- Scout writes .json, adding one more context file to manage: Accepted — scout.json is ephemeral (cleared on each run start) and compact (~500 bytes).

---

## [2026-04-06] Tier-based model routing: Haiku for tier-a (bug-fix-minor), Sonnet for tier-b/c (additive/greenfield)

**Context:** The coder agent is often over-provisioned: a one-line bug fix or a small constant change uses Sonnet's full reasoning chain unnecessarily. Conversely, greenfield UI components (tier-c) need careful state reasoning and should not fall back to Haiku on context pressure. The planner already classifies features by type (`[tier]` signal); we can use this to route the coder model dynamically.

**Decision:** Planner emits `[tier]` signal after `[summary]`: `a=bug-fix-or-minor`, `b=additive-backend-or-logic`, `c=greenfield-UI-or-frontend`. Coder model selection in shared.ts (buildAgentsJson):
- Tier-a → Haiku (cost ~15k tokens vs ~30k Sonnet; sufficient for localized edits)
- Tier-b → Sonnet (logic changes, async flow, state mutations benefit from strong reasoning)
- Tier-c → Sonnet (UI state, component lifecycle, Svelte reactivity require expert model)
Additionally, FULL mode promotes all 5 reviewers to Sonnet (normally LEAN has Haiku reviewers where possible).

**Alternatives considered:**
- Use code complexity heuristic (AST-based): Rejected — requires static analysis tooling; planner has semantic context and can classify more accurately.
- Route coder by file type (always Sonnet for .svelte, Haiku for .ts utilities): Rejected — tier-a can involve .svelte changes (e.g., remove unused import); file type is too coarse.
- Route post-hoc via reviewer feedback (write-to-disk tier, let coder choose model): Rejected — adds loop iteration; model choice should be deterministic from the planner classification.

**Reason:** Planner's tier signal is semantically rich (tier-a is genuinely simpler) and available before coder invocation, so coder model can be determined statically without guesswork.

**Trade-offs:**
- Tier classification is planner's responsibility; misclassification (tier-b marked as tier-a) causes underprovisioned coder: Accepted — planner has explicit tier definitions; reviewer feedback loop catches misclassifications, and [revision-mode] rerun on Sonnet is available as fallback.
- Haiku routing for tier-a is not universal; some bug fixes are subtle: Accepted — revision loops and FULL mode override ensure fallback paths; tier-a is an optimization, not a hard constraint.

---

## [2026-04-06] Tightened BLOCK thresholds across all 5 reviewers: BLOCK only for silent runtime failures or unrecoverable states

**Context:** Early reviewer runs (phases 1–5) required BLOCK verdicts to be conservative: any missing error handling, performance concern, or style deviation could block. This prevented fast iteration. Now that revision loops and [revision-mode] are in place, we can tighten thresholds: REVISE for fixable issues, BLOCK only for truly unrecoverable problems (silent data corruption, credential leak, path traversal, unhandled promises with no logging, race conditions).

**Decision:** Each reviewer's BLOCK threshold is tightened to one category only:
- **reviewer-safety**: BLOCK for path traversal, injection, credential leak, or missing contextIsolation. Everything else → REVISE.
- **reviewer**: BLOCK for broken IPC contract only (e.g., handler missing, type mismatch that silently breaks at runtime). Everything else → REVISE.
- **reviewer-logic**: BLOCK for silent data corruption, unhandled rejection with no feedback, or unrecoverable race condition. Everything else → REVISE.
- **reviewer-performance**: BLOCK for sync calls freezing UI thread or unbounded memory growth. Everything else → REVISE.
- **reviewer-style**: NEVER BLOCK. Always REVISE.

**Alternatives considered:**
- Keep early-phase conservative BLOCK rules, add fast-track "tier-a can skip to implementer": Rejected — tier routing is upfront (planner), not post-review; fast-track complicates the gate logic.
- Per-mode BLOCK rules (LEAN blocks more, FULL blocks less): Rejected — reviewers should be consistent; mode affects which reviewers run, not what they block on.
- Deprecate BLOCK entirely in favour of REVISE + "soft block" (warning without revision gate): Rejected — true blockers (security, runtime failure) must stop the run; soft warnings are subsumed in REVISE suggestions.

**Reason:** Revision loops + [revision-mode] make it safe to REVISE instead of BLOCK for fixable issues. BLOCK is now reserved for the truly unrecoverable: problems that revision cannot fix without major rework or that represent a hard constraint violation.

**Trade-offs:**
- More REVISE verdicts → more revision loops → longer wall-clock time per run on complex features: Accepted — per-tier routing (Haiku for tier-a) and scout pre-step offset this; real-world tier-a/b runs see net speedup.
- BLOCK is rarer, so the gate "BLOCK"  signal may feel less impactful: Accepted — gate #2 still blocks when BLOCK verdict appears; the signal is now more meaningful (fewer false alarms).

---

## [2026-04-02] Intent log persistence: Fire-and-forget IPC with two entries per cycle, not one-per-run

**Context:** Intent classification analysis requires understanding patterns in what prompts the classifier detects, how often users override the detection, and the latency of the classification itself. A single log entry per run would not distinguish between classification time (when Haiku responds) and confirmation time (when the user submits). Additionally, the log must capture both successful classifications and error cases for latency analysis.

**Decision:** Emit two log entries per classification cycle:
1. At classification result time: record detected pipeline/mode, classification latency (measured start-to-end of the IPC invoke), status (ok/error), and error message if applicable. `overridden: false` because no override has happened yet.
2. At confirmation submit time: record final pipeline/mode (may differ from detected if user touched dropdowns), `overridden: true/false` based on whether `overridePipeline` or `overrideMode` deviated from the empty string, and `latencyMs: 0` (confirmation is instant, no new latency to measure).

Calls are fire-and-forget (`.catch(() => {})`) from the renderer because log failures must never block run dispatch.

**Alternatives considered:**
- Single entry per confirmation, backfill latency: Rejected — requires storing latency in component state or editor store, complicating state management for a non-essential diagnostic field.
- Store logs in memory (sessionStore), persist on app close: Rejected — loses data on crashes and makes real-time log inspection impossible; JSONL disk persistence is the standard for audit logs.
- Synchronous file writes in renderer: Rejected — renderer has no Node access (contextIsolation: true); must go through IPC.
- Append log as a side effect of ipc.run(): Rejected — run invocation is for execution, not for logging a prior interaction; concerns should be separated.

**Reason:** Two entries cleanly separate latency measurement (classification time) from override detection (confirmation time), and fire-and-forget IPC ensures logging never impacts run flow.

**Trade-offs:**
- Renderer calls IPC twice per cycle instead of once: Acceptable — both calls are fire-and-forget and run in parallel; no blocking I/O.
- Log file grows faster: Accepted — 1000-entry cap is conservative for analysis; entries are compact JSON lines (~200 bytes each). Storage cost is negligible.
- Confirmation entry has `latencyMs: 0`: Accepted — the log purpose is to measure classification latency (stored in the first entry) and override frequency (stored in both entries with different `overridden` flag). Confirmation itself does not have a meaningful latency to measure.

---

## [2026-04-02] Pipeline type routing: Use confirmed detection in run path, not mode selector

**Context:** Phase 1b routes intent classification to the UI (confirmation chips), but the run initialization code (`ipc.run`, `runStore.startRun`, `agentsStore.initAgents`, feature title tracking) was still using `editor.mode` (the static mode selector) instead of the detected pipeline type. This meant a user could confirm a detection (e.g. "implement feature" when they wrote an implementation task), but the run would actually execute under a different pipeline if they had previously selected a different mode in the selector. The confirmed classification was displayed but not acted upon.

**Decision:** Introduce `resolvedPipeline` as a local variable in `submit()`: when intent classification was confirmed, use the (possibly user-overridden) detected pipeline type; otherwise fall back to `editor.mode`. Pass `resolvedPipeline` to all downstream calls (`runStore.startRun`, `agentsStore.initAgents`, `PIPELINES` lookup, feature title check). This ensures the confirmed classification is actually routed through the run.

**Alternatives considered:**
- Mutate `editor.mode` directly on confirmation: Simpler — no extra variable needed. Rejected — this makes the mode selector reflect the transient classification, causing confusion if the user dismisses/reruns and the selector unexpectedly changes state.
- Keep using `editor.mode` everywhere: Least disruptive. Rejected — confirmed classifications would be ignored, defeating the entire purpose of the approval step.
- Create an observable store field for the resolved pipeline: Separates state properly but adds Svelte 5 store complexity. Rejected — the resolved pipeline is scoped to a single `submit()` execution; it does not need to be reactive across the app.

**Reason:** A local variable is the minimal scope for a value that is live only during one run. It avoids mutating UI state and ensures the confirmed classification actually takes effect without persistence or propagation to other parts of the app.

**Trade-offs:**
- `resolvedPipeline` is computed from three conditions in one line (ternary): Slightly harder to read but keeps the logic localised. Accepted — the expression is annotated with a comment block.
- Type cast `as ModeId` and `as PipelineId` in downstream calls: Necessary because `resolvedPipeline` is a string. Accepted — safety is documented in the handoff (classifier only emits valid `ModeId` values; fallback to `editor.mode` is always a valid `ModeId`).

---

## [2026-04-02] Phase 1b: Two-Enter confirmation with transient override state, not stored mode mutation

**Context:** Phase 1b implements the UI for intent confirmation: user presses Enter, sees pipeline/mode chips; presses Enter again to confirm. A naive implementation would mutate the editor store's `mode` field, causing the mode selector to update automatically. However, this persists the override into the editor state and makes it visible in the UI permanently, which breaks the mental model — the user expects to *confirm* a one-off classification, not permanently change their mode.

**Decision:** Keep the override transient: local component variables `overridePipeline` and `overrideMode` capture user dropdown edits, survive one submit cycle, and are cleared when confirmation fires or user dismisses. The `pipelineModeOverride` is passed as an optional seventh parameter to `ipc.run()` and injected into the system prompt by `runner.ts` without persisting to disk or the editor store. After the run, the editor store `mode` returns to its pre-classification value.

**Alternatives considered:**
- Mutate editor.mode on confirmation: Simplifies state but makes the override visible in the UI and persists it across runs. Rejected — the user expects intent classification to be ephemeral feedback, not a permanent mode change.
- Store override in project.json as "last detected mode": Speeds up repeated similar tasks but causes stale overrides when the user's intent changes. Rejected — the override should be fresh per-prompt, not cached; project config is for persistent user settings, not transient UI state.
- Pass override through URL params or session cookie: Adds complexity without benefit; IPC parameter is sufficient and scoped to a single run.

**Reason:** Separating *detected* intent (stored, displayed) from *confirmed* intent (transient local vars) from *injected* mode (IPC param, lifetime = one run) keeps the three concerns distinct and prevents surprising persistence of one-off classifications.

**Trade-offs:**
- Two sets of state (editor.intentResult + local overrides): Extra variables in PromptBar. Accepted — the separation is clean: store owns classification truth, local vars own user edits, IPC owns runtime override.
- `pipelineModeOverride` is optional and only set when confirmed: Adds validation in runner.ts to sanitise and inject. Accepted — robust validation (alphanumeric + set membership check) is necessary for any user-supplied runtime parameter.
- Detection summary line appended to terminal only after confirmation: User sees "→ detected: ..." only for runs that actually use the override. Accepted — the line is informational and helps the user track which runs used intent-detected modes.

---

## [2026-04-02] Intent classification: Haiku classifies, Phase 1b displays, no auto-route

**Context:** One Chat Phase 1 vision: replace the static mode selector with dynamic intent detection. A user enters a task prompt; FORGE classifies it into pipeline and mode using a lightweight model call. The pipeline/mode are displayed back to the user for approval before the actual run starts (Phase 1b GUI). A naive implementation would auto-route to the pipeline immediately after classification; however, this skips the approval step and removes the user's agency — they cannot override a bad classification without aborting.

**Decision:** Phase 1a (this feature) delivers only the classification infrastructure: new IPC channel `classify-intent`, Haiku invocation with 5s timeout, result stored in editor store. Phase 1b (future) consumes the result and displays it for approval. No auto-routing. If classification fails or times out, Phase 1a returns a lean fallback (`{ ok: true, pipeline: 'plan feature', mode: 'lean', reason: 'classification unavailable' }`) so Phase 1b can always show *something*; the fallback is annotated so the user knows classification was unavailable and the defaults are not a confident classification.

**Alternatives considered:**
- Immediate auto-route on success: Speeds up workflow but removes approval step. Rejected — violates One Chat principle of showing user the classification before proceeding.
- Larger/slower model (e.g. Claude 3.5 Sonnet): More accurate classification but adds latency and cost; Haiku is adequate for MVP. Rejected — Phase 1a optimizes for speed; if Phase 1b shows a bad classification, the user can reject it.
- Store classification in project config as "last used pipeline": Speeds up repeated runs but causes stale classifications when the user's task changes. Rejected — classification should be fresh per-prompt, not cached.

**Reason:** Splitting intent detection (Phase 1a) from display/approval (Phase 1b) allows FORGE to show the user a structured classification proposal before committing to a pipeline, preserving human agency while automating the analysis step.

**Trade-offs:**
- Phase 1a stores result in editor state but does not route: Extra data in store and extra Phase 1b logic to consume it. Accepted — the coupling is loose; Phase 1b can ignore intentResult if it prefers the mode selector.
- Fallback classification has same form as success: Phase 1b must check `reason` field to detect unavailable classification. Accepted — reason field is always present and the fallback reason 'classification unavailable' is explicit enough.

---

## [2026-04-02] Tester removed from apply pipelines — on-demand via UI toggle instead

**Context:** Historically, tester ran as part of all apply phases (apply feature, apply debug, apply refactor). Tester is token-heavy (typically 200k per run), and most development workflows skip testing entirely until final validation. Running tester unconditionally added latency and cost to every apply, even when the user wanted quick iteration without formal testing.

**Decision:** Remove tester from the standard apply pipeline. Add a `testerEnabled` boolean to ui.svelte.ts that persists across runs until reset. When an apply chip is visible, ChipsStrip shows a TEST OFF/ON toggle. The user can toggle testing on before running apply if they want formal testing; otherwise, apply runs only implementer → documenter. The testerMode project setting (off/ask/on) still controls tester *behavior* during apply; testerEnabled controls *presence* in the agent network.

**Alternatives considered:**
- Keep tester always-on; add a "skip testing" prompt in the apply phase: Would require user interaction at every apply; many users would skip by default, making the toggle implicit rather than explicit. Rejected — explicit UI control is clearer.
- Move tester to a separate "run tests" button (not apply): Complicates the apply flow and requires extra user context-switching. Rejected — users often want to validate before applying; coupling tester to the apply decision is more natural.
- Require testerMode=off to suppress tester: That's already how it works at the project level; the issue is that not all projects adopt testerMode=off. Rejected — the problem is the default behavior of unconditional runs.

**Reason:** Tester is a validation tool, not a required step. Making it opt-in reduces friction for iteration and lets users decide when testing is appropriate, rather than forcing the cost at every apply.

**Trade-offs:**
- Users might forget to toggle tester on when they should test. Accepted — the toggle is visible and the documenter notes in CHANGELOG will highlight when testing was skipped; users retain agency.
- Tester is now conditional on UI state rather than project config. Accepted — the testerMode project setting remains the canonical configuration; testerEnabled is a per-session toggle that respects project intent.

---

## [2026-04-02] Pipeline modes (direct, sprint, lean, standard, full) — configurable reviewer set

**Context:** FORGE historically had two hardcoded reviewer sets: "all reviewers" (for plan and implement) and "no reviewers" (for apply). A new workflow pattern emerged: users wanted a "quick review" mode (basic safety checks, no deep review) for iteration, and a "full review" mode (all 5 reviewers, high rigor) for critical features. The apply pipeline's fixed agent set made it impossible to tune the rigor level.

**Decision:** Replace the hardcoded `PipelineType` enum (plan, implement, apply, debug, refactor) with a two-level system: `PipelineType` (pipeline family: plan/implement/apply/debug/refactor) and `PipelineMode` (reviewer rigor: direct, sprint, lean, standard, full). Modes are configurable per project in settings. All pipeline types now accept a mode parameter, which selects the reviewer set via `PIPELINE_MODE_AGENTS` table. Default mode is `'lean'` (basic safety + core reviewer), not `'standard'` (all reviewers), reducing token cost for typical runs.

**Alternatives considered:**
- Three-tier system (type, mode, rigor): Adds an extra dimension and makes classification more complex. Rejected — two-level (type + mode) is sufficient.
- Modal dialog at prompt time asking "which reviewers?": Adds UI complexity and requires interaction at every run. Rejected — mode is a persistent project preference, not a per-run choice (except for ad-hoc override in future).
- Keep hardcoded reviewer sets; add skip conditions per phase: Polices around "skip tester if project has `testerMode=off`"; adds special cases to the runner logic. Rejected — a config table (mode → agents) is clearer and more extensible.

**Reason:** Configurable modes decouple reviewer set from pipeline type, allowing projects to tune rigor independently of task family. Lean as the default reflects the common case (most work is low-risk or iteration) while keeping full review available for high-risk phases.

**Trade-offs:**
- Mode is a per-project setting, not per-task: If a user wants to run one task in lean and another in standard, they must change settings. Accepted — mode is stable across a session; per-task override is a future feature if demand appears.
- Mode name (`lean`, `standard`, `full`) is less explicit than listing all reviewers: A user must check the documentation to know what each mode includes. Accepted — the settings UI will show a summary; the names map to familiar concepts (lightweight, normal, rigorous).

---

## [2026-04-01] Revision loop early exit for warnings-only REVISE verdicts

**Context:** Plan and coder revision loops iterate on reviewer feedback until all BLOCK verdicts are resolved. Previously, a REVISE verdict with 0 blockers (warnings only) triggered a full cycle through the planner or coder again, even though warnings do not gate the feature. A session that received REVISE from reviewer-logic with 0 blockers across all 3 revision cycles cost 1M tokens and 15 minutes — each cycle re-ran the full planner + reviewer-logic chain unnecessarily.

**Decision:** Both plan and coder revision loops now check: "if every pending verdict is REVISE with 0 blockers (warnings only, no BLOCKs), exit the loop immediately." Warnings are advisory and do not require a plan or code revision before proceeding to the next gate or apply phase. The verdicts still carry forward to the next stage (e.g., warnings from plan revision appear in Gate #2 notes for the implementer).

**Alternatives considered:**
- Silence warnings in revision loops: Don't emit them until the final apply. Rejected — warnings have value during revision; they inform the planner and coder of quality concerns; early exit still surfaces them to implementers.
- Auto-promote REVISE to APPROVED if 0 blockers: Simplifies the logic but hides the fact that reviewers found issues. Rejected — REVISE signals "changes recommended"; early exit honors that signal while acknowledging that warnings don't block.
- Require revisions until APPROVED verdict: More conservative, but causes runaway revision loops and token waste when reviewers are conservative. Rejected — the gate system's purpose is to catch real problems, not to achieve perfect code.

**Reason:** Verdicts with 0 blockers (warnings only) represent advisory feedback, not gate-blockers. Early exit respects the feedback while avoiding wasteful re-cycles. Warnings still propagate to the next stage for implementers and users to consider.

**Trade-offs:**
- A planner or coder might miss an opportunity to refine based on warnings. Accepted — warnings are still present in the output; the agents can reference them if they revisit the feature later. The trade-off prioritizes forward momentum over perfectionism.
- Users see warnings in the gate notes without a dedicated "revised per warnings" section. Accepted — warnings appear in the verdict output and are visible in the gate; users can read them alongside the feature.

---

## [2026-04-01] Planner Pass 1 enforcement before tool use

**Context:** The planner historically had an "escape hatch" in its design: "if the feature description is clear enough, skip Pass 1 and go directly to Pass 2" (tool use and PLAN.md writes). This was intended as a performance optimization for straightforward features. In practice, the escape hatch was not consistently applied or documented, causing the planner to sometimes skip Pass 1 without emitting Q&A questions when questions were needed.

**Decision:** Planner now enforces Pass 1 as mandatory before any tool use. The first check is explicit: "scan the prompt for `[answers]` block. If absent, run Pass 1 only (read project.json, emit questions via `[questions]...[/questions]`, stop). No source file reads on Pass 1. No writing PLAN.md." Pass 1 is now unconditional — there is no escape hatch. The model must receive answers before proceeding to Pass 2.

**Alternatives considered:**
- Keep the escape hatch but document it more clearly: Would require the model to make a judgment call on "clear enough." Rejected — judgment calls are inconsistent; mandatory rules are predictable.
- Emit questions but also proceed to Pass 2 in parallel: Answer questions and plan in the same run. Rejected — answers affect the plan; running both in parallel creates race conditions and ambiguity about which version is the "final" plan.
- Move Pass 1 to a separate agent pre-stage: Planner runs twice — first pass (questions), then a dedicated question-answering stage, then planner again for Pass 2. Rejected — doubles the planner calls and adds latency; enforcing Pass 1 within a single planner call is more efficient.

**Reason:** Mandatory Pass 1 simplifies the planner's behavior to a single, predictable rule: always ask questions before planning. This eliminates the "unclear if questions will be asked" uncertainty that caused skipped Q&A.

**Trade-offs:**
- Straightforward features now incur an extra round trip (question → answer) even if the feature is self-evident. Accepted — the overhead is small (one extra orchestrator cycle) and the predictability is valuable. If a feature genuinely requires no questions, the user can provide a dummy `[answers]` block in the prompt.
- Planner no longer optimizes for "no-question" features. Accepted — the latency is acceptable and the predictability gain outweighs the optimization.

---


## [2026-03-31] Gate 2 override button for blocked state

**Context:** Gate 2 (implementer gate) can become blocked in two scenarios: (1) a real reviewer verdict sets BLOCK, (2) verdicts.jsonl contains no entries for a completed run in LEAN mode. Case 2 is a false positive when reviewers are intentionally skipped. Previously, a blocked gate showed no action buttons — the user had no escape route except dismissing the gate and manually reviewing the output.

**Decision:** Add an "OVERRIDE — APPLY ANYWAY" button to the blocked state alongside the existing DISMISS button. The override reuses the same `apply()` function as the normal YES button, allowing the user to proceed despite the block.

**Alternatives considered:**
- Auto-resolve false positives in verdicts.ts: Detect missing-verdict blocks and clear them automatically. Rejected — a block is a signal that something needs human attention; auto-clearing hides that signal and erodes trust in the gate.
- Gate requirement: Mandate that LEAN mode always produces verdicts, even if reviewers don't run. Rejected — the simplicity of LEAN mode (no reviewer invocation) is intentional; adding verdict requirements defeats that purpose.
- Warn instead of block: Show a yellow warning on Gate 2 instead of a red block. Rejected — the gate already uses warnings for other conditions; a hard block is visually distinct and signals that a real decision point exists.

**Reason:** Users occasionally hit false-positive blocks during development and testing (e.g., tank fan project). An override gives them a way forward without losing confidence in the gate system. The override is labeled cautiously (dim, yellow on hover) to signal that it should be used sparingly, not as a routine path.

**Trade-offs:**
- The override bypasses the gate's verification. Accepted — the gate is a safety checkpoint, not a requirement; users retain agency over the apply decision.
- Two buttons (OVERRIDE and DISMISS) make the blocked state busier. Accepted — the blocked state is rare; the extra button adds clarity without adding UI noise elsewhere.

---

## [2026-03-31] Monolithic SKILLS.md replaced with per-capability files

**Context:** FORGE's SKILLS.md grew to ~1500 lines with separate subsections for each tech stack (Electron, Svelte5, TypeScript, etc.). When agents receive skills context, they read all subsections, even for stacks irrelevant to the current task (e.g., a TypeScript-only task reads Electron IPC guidance). This adds context noise and token cost. Agents need a way to receive only the capabilities relevant to their current work.

**Decision:** Replace the monolithic SKILLS.md subsection model with per-capability `.md` files stored at `templates/code/docs/gotchas/skills/<id>.md` (e.g., `electron-ipc.md`, `svelte5-reactivity.md`). Each file contains `## <AgentRole>` sections for the same agent roles (Planner, Coder, Implementer, Reviewer-Logic, Gotcha Checker). At pipeline time, projects store a `capabilities` array in `.pipeline/project.json` (e.g., `["electron-ipc", "svelte5-reactivity"]`). The `buildSystemPromptAppend` function calls `filterSkillsByCapabilities()` to read only matching files and extract the relevant agent-role sections.

**Alternatives considered:**
- Stack-scoped files (e.g., `skills/electron.md`, `skills/svelte.md`): Organizes by tech layer, but agents still receive all Electron guidance (IPC, security, CLI) even for an IPC-only task. Rejected — overly broad scope.
- Dynamic capability inference from handoff AST: Parse the handoff task list to infer required capabilities (e.g., if a task modifies an IPC handler, infer `electron-ipc`). This removes the need for explicit declaration. Rejected — handoff format is unstructured and inference is fragile; explicit declaration is more maintainable and gives users control.
- Keep SKILLS.md monolithic, add a runtime filter in prompts: Have the agent-role preamble tell agents to "skip irrelevant sections." Rejected — agents ignore this advice under pressure; explicit exclusion is more reliable.

**Reason:** Fine-grained capability scoping reduces context noise, lowers token cost, and makes agent guidance more precise. Explicit project-level declaration gives users visibility and control over what the system considers "relevant" to their project.

**Trade-offs:**
- New projects must declare capabilities (either auto-detected from stack label or manually selected). Accepted — wizard auto-populates based on STACK_TO_CAPABILITIES mapping; users can edit before import.
- Existing projects without a capabilities array fall back to the old `filterSkillsByStacks` path (full SKILLS.md). Accepted — backwards-compatible; no migration needed.
- Per-capability files are more numerous (5 files instead of 1). Accepted — 5 small files (150–250 lines each) are easier to search and update than one 1500-line file.

---

## [2026-03-30] Approach block before summary in Gate #1

**Context:** The planner surfaces design reasoning (key decisions, trade-offs, uncertainties) at Gate #1 so users can push back before clicking Implement. Two orderings are possible: approach before summary, or summary before approach. The summary is a one-line assertion; the approach is multi-line reasoning. Order affects readability and cognitive flow.

**Decision:** Approach block appears *before* the summary in Gate1Bar rendering and in planner output. The planner emits `[approach]...[/approach]` block, then `[summary]`, so the UI receives approach first in the stdout stream. Gate1Bar renders them in receive order: approach (with label and border), then summary. This order frames the reasoning first, then the conclusion.

**Alternatives considered:**
- Summary before approach: Leads with the assertion, then justifies it. More concise at first glance but requires the user to back up to understand *why* the feature is recommended. Rejected — the gate is for deliberation, not quick approval.
- Render approach as a collapsed/expandable section below the summary: Reduces visual weight but adds interaction cost. Rejected — the approach is essential context for the gate decision, not secondary detail.

**Reason:** Reading order (top to bottom) should follow logical order (reasoning → conclusion). Users can see the full case before making the gate decision, without needing to expand or scroll.

**Trade-offs:**
- Gate #1 is taller when approach is present (spans multiple lines). Accepted — the height cost is minor and the clarity is valuable.
- Planner must emit signals in a specific order for correct rendering. Accepted — this is enforced by agent definition and documented in planner.md.

---

## [2026-03-30] Module wiring strategy — captured by documenter vs. architect

**Context:** The system needs to track which files, stores, and IPC channels each module owns or depends on. Without this metadata, it is difficult to understand module scope, detect coupling, or validate that new features land in the right module. The architect agent can statically analyze the codebase and the documenter agent can observe actual file changes during apply runs.

**Decision:** Both agents now capture and maintain module wiring metadata (keyFiles, stores, ipcChannels, dependsOn, usedBy). The architect populates these fields during architecture reviews via a JSON schema that lists each field and its rules. The documenter auto-populates wiring on every apply run by scanning the handoff for new files, IPC channel strings, and store references, then appending matches to the appropriate module record. The documenter creates missing module records on-demand if the handoff feature references a module not yet in modules.json.

**Alternatives considered:**
- Only architect captures wiring: Would require running architect every time wiring changes, or maintaining wiring manually. Rejected — the documenter already observes actual changes on every apply, so it can incrementally capture metadata.
- Only documenter captures wiring: Would miss wiring information for modules not touched in recent runs. Rejected — architect provides comprehensive initial scans and fills gaps during architecture reviews.
- Manual hand-maintained wiring spreadsheet: Becomes stale immediately and provides no integration with the pipeline. Rejected.

**Reason:** Dual-source wiring (architect + documenter) provides both comprehensive initial scans and incremental observation of real changes. The documenter runs on every apply, so it captures live changes automatically; the architect fills gaps and validates comprehensiveness during architecture reviews.

**Trade-offs:**
- Wiring metadata may briefly diverge between architect snapshots and live changes. Accepted — the documenter brings it back into alignment on the next apply.
- The architect schema requires explicit field documentation for each wiring type. Accepted — this clarity is a feature, not a bug; it prevents silent misunderstandings about what each field represents.

---

## [2026-03-30] Module suggestion via QA strip in planner vs. manual assignment

**Context:** When a planned feature does not fit into any existing module, the planner agent must either leave the feature unassigned, require the user to manually specify a module, or suggest a reasonable module name. Leaving it unassigned is silent and error-prone; manual assignment requires user context-switching; auto-suggestions may be wrong but are easily corrected.

**Decision:** The planner now proposes a suggested new module name via the QA strip (a `[questions]` block with a single option showing the suggestion) when no existing module fits. The user can accept the suggestion with one click, or type a different name, or reject it entirely. On re-invocation (via `[module] <module-id>`), the feature is assigned to the new or user-specified module. This keeps the planner autonomous while preserving user control.

**Alternatives considered:**
- Leave unassigned and require manual fix-up later: Silent failures, poor UX. Rejected.
- Reject the feature and ask the user to pre-specify a module: Blocks the pipeline and requires context-switching. Rejected.
- Always create a new module automatically: Runs the risk of creating duplicate or poorly-named modules. Rejected.

**Reason:** QA strip interaction is non-blocking and already present in the system for clarification; a one-option question is natural UX and preserves autonomy while requiring explicit user opt-in.

**Trade-offs:**
- Users see an extra QA strip prompt. Accepted — the prompt is minimal (one option) and educational (shows the planner's reasoning).
- If the user ignores the suggestion and the feature is left unassigned, it will appear as a todo rather than a planned item. Accepted — this is visible and easily fixed.

---

## [2026-03-30] Gate #2 failure state vs. immediate error exit

**Context:** When the apply pipeline (implementer + tester + documenter + cleanup) completed with a non-zero exit code, the system previously had no way to distinguish a clean completion from a failed run. The tester agent emits output and may decide to stop the run; the implementer may exit with non-zero on task completion. Without explicit failure signaling, the UI treated all non-zero exits identically, conflating clean stops with actual errors.

**Decision:** Introduce a `failed` GateStatus value in `gate.svelte.ts` and call `failGate2()` on non-zero exit from the apply pipeline. Gate2Bar renders a distinct APPLY FAILED state with red styling and failure messaging. This allows users to immediately see whether an apply completed normally or failed. Separately, the tester agent emits `[tester-gate]` signal to show TesterGateBar when complete — this is orthogonal to the exit code and may occur on success or failure.

**Alternatives considered:**
- Keep current behavior (no explicit failure state): Loses critical information at a pivotal moment. Users cannot tell if `exit 1` means "tests failed" or "apply finished successfully but implementer exited early." Rejected.
- Add a new `[apply-failed]` signal that agents emit: Requires coordination across implementer, tester, and documenter. Fragile — any missing signal coordination breaks the system. Rejected.

**Reason:** Exit code is the OS's standard communication mechanism for success/failure. Using it directly in the UI is the most reliable and least invasive approach.

**Trade-offs:**
- If a future agent intentionally exits non-zero to signal a state that is not a failure, Gate #2 will show APPLY FAILED even though the state is not an error. Accepted — if this becomes necessary, add a new signal that overrides the exit code interpretation, checked before the exit code.
- Gate #2 now has four possible states (RUNNING, APPROVED, BLOCKED, FAILED); this increases visual complexity slightly. Accepted — the states are orthogonal and each has clear meaning.

---

## [2026-03-30] Per-run cost telemetry via recentRuns array

**Context:** The UsagePanel showed cumulative costs across an entire session, but users wanted to understand the cost of individual runs — especially to debug why a particular apply run cost more than expected, or to compare cost across different feature pipelines.

**Decision:** Add a `recentRuns` field to the agents store that tracks the last 5 completed runs. Each entry contains: `mode`, `totalCost`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `timestamp`. On run completion, append the run's token usage to recentRuns; trim to keep only the last 5. The UsagePanel displays this as a "RECENT RUNS" table showing mode, cost, and token breakdown per run. The pipeline-logs handler returns recentRuns on load so the UI is populated even after a browser refresh.

**Alternatives considered:**
- Store per-agent costs instead of per-run totals: More granular but increases complexity substantially. Users can already drill into individual agent output in the terminal; per-agent cost would be redundant. Rejected.
- Use localStorage to persist recentRuns across app restarts: Adds complexity; users typically compare runs within a session. If cross-session comparison becomes needed, localStorage can be added later without breaking the current design. Rejected.

**Reason:** Per-run cost gives users immediate insight into pipeline cost without requiring them to read terminal output or notes. The 5-run window is large enough to see trends (e.g., "apply feature is usually $X") but small enough that the table stays readable.

**Trade-offs:**
- recentRuns is volatile — lost when the app closes. Accepted — this is appropriate for telemetry; if permanence is needed, a future migration to persistence should be explicit and scoped.
- Each run must be recorded; if a run is interrupted early, its cost may be partial. Accepted — this is acceptable for a telemetry system; users can always run again if they need a clean measurement.

---

## [2026-03-28] PLAN.md as single-active-feature file; queued backlog in BACKLOG.md

**Context:** `docs/PLAN.md` was growing unbounded — completed `[x]` features were not being archived consistently, and queued features accumulated alongside the active one. This caused every planner/researcher/gotcha-checker/coder run to read a 150–200 line file of mostly irrelevant content, wasting tokens on every pipeline run.

**Decision:** `docs/PLAN.md` holds **at most one active feature at a time**. Documenter removes the section after apply and appends it to `docs/PLAN-archive.md`. Queued features that have not started yet live in `docs/BACKLOG.md`, which no pipeline agent reads during runs. Agents that need the active plan read only `docs/PLAN.md`; agents that need completed features (nyquist-auditor) read `docs/PLAN-archive.md` as fallback.

**Alternatives considered:**
- Keep everything in PLAN.md with a size limit (archive when >150 lines): Fragile — requires agents to check file size; the "150 line" threshold is arbitrary and breaks silently.
- Use a single archive file for both queued and completed features: Conflates two distinct states. Queued features may be promoted back to active; completed features are immutable. Separate files make the distinction explicit.

**Reason:** Reduces per-run token cost for every planning-phase agent. PLAN.md stays at ~20 lines between runs. Token savings: ~10k tokens per pipeline run for any run that includes the planner, researcher, gotcha-checker, or coder.

**Trade-offs:**
- Nyquist-auditor must read PLAN-archive.md as fallback — small complexity cost, now handled in the agent prompt.
- BACKLOG.md is manually managed — no pipeline automation keeps it consistent. Accepted — backlog is editorial, not operational.

---

## [2026-03-27] Planner Step 0: Tier-based question counts vs. fixed count

**Context:** The planner's Step 0 originally asked a fixed 2–5 clarifying questions for every feature, regardless of scope. This caused two problems: (1) simple bug fixes received 2–5 questions when 0–1 would suffice, inflating the question block for low-risk work; (2) complex UI features often needed more questions than 5 could capture without exceeding the 8-question parser ceiling, forcing design choices to be underspecified to fit the ceiling.

**Decision:** Classify features by intent into three tiers with tier-specific question-count targets: (a) bug-fix-or-minor → 0–2 questions, (b) additive-backend-or-logic → 2–4 questions, (c) greenfield-UI-or-frontend → 5–8 questions. This matches question depth to feature scope and risk. Additionally, implement mandatory visual-design questions (style/theme, content/layout, audience/interaction) for any feature that produces visible UI, applied after tier classification and before the design-fork questions.

**Alternatives considered:**
- Use keyword matching (e.g., "if the feature name contains 'bug'") to classify tier: Brittle and prone to false positives. Features like "Add bug reporting UI" or "Fix the settings bug" have different intents. Rejected — judgment-based classification is more robust.
- Keep a fixed 2–5 count but apply a "skip obvious questions" rule: Does not solve the mismatch for either tiny or large features. Rejected — tier-based targets are more principled.
- Allow the planner to emit 0–10 questions dynamically without a ceiling: Violates the FORGE parser's hard 8-question limit (per GENERAL.md QaStrip constraint). Rejected — the 8-question ceiling is non-negotiable.

**Reason:** Feature scope varies wildly. Bug fixes and tier (b) logic changes are low-risk and can proceed with minimal clarification; UI features touch the user-facing design surface and always warrant deeper exploration. Matching question count to feature intent and risk reduces both over-questioning and under-specification.

**Trade-offs:**
- Planner now makes a judgment call on tier classification instead of following a mechanical rule. This requires human-level intent reading. Accepted — mitigated by explicit examples and a "classify up when uncertain" default that errs toward safer, more thorough planning.
- The "classify up not down" default means some low-risk features will receive more questions than strictly necessary. Accepted — a slightly-long question list is recoverable; a too-short one leads to plan rework and scope creep.

**Related decision:** Project context injection (SKILLS.md ownership) — complements this by providing planner with project description at runtime, enabling the pre-read step that eliminates questions already answered in the project context.

---

## [2026-03-27] SKILLS.md ownership: FORGE-injected at runtime vs. project-owned copies

**Context:** FORGE previously copied `SKILLS.md` from template directories into each new project's `docs/gotchas/` folder during scaffolding. This created two problems: (1) each project's SKILLS.md became a frozen snapshot of the template's SKILLS at creation time, diverging from FORGE's evolving guidance; (2) bug fixes or improvements to SKILLS.md in FORGE's templates never reached existing projects — projects had to be manually migrated or recreated to benefit from updates.

**Decision:** Remove the SKILLS.md copy step entirely. Instead, read SKILLS.md directly from FORGE's own `templates/` directory at runtime (selected by the project's declared `techStackLabels` via the new `stackLabelsToTemplateFolder` helper). This way, every run reads the current FORGE-owned SKILLS.md, keeping stack-specific guidance always up to date.

**Alternatives considered:**
- Keep copying but add a migration/sync mechanism to push SKILLS.md updates from FORGE into existing projects: Creates maintenance overhead and requires running sync logic across an unbounded set of projects. Rejected — runtime injection is cleaner.
- Store SKILLS.md in a shared location (e.g., `~/.forge/SKILLS.md`) that both FORGE and projects read: Adds global state and requires installation/setup overhead. Rejected — simpler to keep it in the FORGE package.
- Let projects opt-in to runtime injection while keeping copy-based SKILLS for legacy projects: Increases complexity and creates two codepaths. Rejected — all projects should benefit from the simpler model.

**Reason:** SKILLS.md is operational guidance, not project data. It should be owned and maintained by FORGE, not forked into each project. Runtime injection ensures every project always has the latest guidance without manual migration steps.

**Trade-offs:**
- Projects now depend on FORGE being installed and available at runtime to get SKILLS.md injected. If FORGE is unavailable or broken, SKILLS content is not injected (but agents still work with GENERAL.md + defaults). Accepted — FORGE is already required to run pipelines, so this is not a new dependency.
- The `--append-system-prompt` grows slightly larger on every run because SKILLS.md is read fresh instead of cached from the project folder. Accepted — token cost is minimal for a few thousand characters of guidance.

**Related decision:** [2026-03-27] Project context injection in scaffold — captures user-provided project name and description so agents have human intent available at runtime, addressing the other half of context loss that occurs after project creation.

---

## [2026-03-25] Separate Expand-State Records for SKILLS Tab Name Collisions

**Context:** The SKILLS tab in SettingsModal displays two sections: FORGE's own skills (loaded from `docs/gotchas/SKILLS.md`) and generated template skills (loaded from `appRoot/templates/*/docs/gotchas/SKILLS.md`). When rendering collapsible cards for each stack, both sections use the stack name (e.g., "Node.js / TypeScript") as the card header and key. If the user has generated a template with the same name as a FORGE skill stack, the expand/collapse toggle would share state, causing one section's card to affect the other.

**Decision:** Maintain two independent `$state` records — `expandedStacks` for FORGE skills and `expandedTemplates` for generated templates — so each section's expand state is isolated and cannot collide, even when stack names match.

**Alternatives considered:**
- Use a composite key in a single expand record (e.g., `"forge/Node.js"` vs `"template/Node.js"`): Reduces code duplication but complicates the onClick handler with key synthesis. Rejected — the two-record approach is simpler and clearer.
- Namespace the stack names in the UI (e.g., prepend "FORGE: " or "Template: " to display names): Would prevent visual collision but does not solve the logical problem of shared state and is unnecessarily verbose. Rejected.
- Use a single expand record with name-deduplication (e.g., rename colliding template stacks to "Template — <name>"): Forces the data model to change based on display concerns. Rejected — rendering logic should not mutate data.

**Reason:** This decision keeps the state model simple and correct: two independent features, two independent state records. It removes the possibility of subtle bugs where one card's expand state affects another.

**Trade-offs:**
- Minimal code duplication: the onClick handler and expand checks are written twice (once per section). Accepted — this duplication is intentional and signals the conceptual separation. Refactoring to a shared expand logic would introduce the collision risk we are avoiding.

---

## [2026-03-25] Dual-Modal Agent Management — Ownership-Based Separation

**Context:** Agent management was originally centralized in a single AgentModal accessible from the titlebar. This created two problems: (1) FORGE's internal scaffold agents (planner, coder, reviewers, etc.) were presented as editable alongside user project agents, creating confusion about which agents are system-critical vs. project-specific; (2) the modal was isolated from the context where agents are actually used (project overview for project agents; settings for FORGE configuration). Users had to navigate away from the project to edit project agents, fragmenting the workflow.

**Decision:** Split agent management into two distinct interfaces by **ownership and context**:
- **FORGE-owned scaffold agents** (immutable): Read-only AGENTS tab in SettingsModal, showing FORGE's 21 system agents with role, model, description, and pipeline position. Scaffold agents cannot be edited or deleted from the UI; they can only be synced to the latest version via SYNC TO LATEST.
- **Project-owned custom agents** (mutable): Full CRUD editor in ProjectOverviewModal under CUSTOM AGENTS section alongside modules and tech stack. Project agents are fully editable (create, read, edit, delete) and are stored in `.claude/agents/` alongside FORGE agents at the file level but logically separated in the UI.

This split eliminates the single AgentModal and its AgentListPane/AgentEditorPane sub-components entirely.

**Alternatives considered:**
- Keep AgentModal but add visual distinctions (e.g., "SCAFFOLD (system)" vs "CUSTOM (editable)" badges): Would reduce confusion but still require users to navigate away from project context. Rejected — the context switch is the root UX problem.
- Separate into three UIs: scaffold agents in Settings, project agents in Project Overview, and a separate "Agent Sync Manager": Adds complexity; sync-to-latest is a low-frequency operation that does not warrant its own modal. Rejected.
- Store FORGE scaffold agents in a separate directory (not `.claude/agents/`): Would eliminate file-level mixing but breaks agent discovery and requires special handling in the runner. Rejected — the separation is conceptual (UI layer) not physical (filesystem).

**Reason:** This decision clarifies ownership (FORGE vs. project) and context (admin settings vs. project overview), reducing UX friction and cognitive load. Users can now edit project agents without leaving the project, and FORGE agents remain visibly off-limits without aggressive UI barriers.

**Trade-offs:**
- The read-only AGENTS tab in Settings removes the ability for users to fork or customize FORGE's own agents from the UI. Accepted — FORGE agents define the pipeline contract and must remain stable; if users need custom pipeline logic, they create project agents and assign them to hook points.
- Scaffold and project agents are still mixed in the filesystem (`<project>/.claude/agents/`). Accepted — this is transparent to users; the UI separation is sufficient for clarity. The `SCAFFOLD_AGENT_NAMES` set guards against accidental project deletion.

---

## [2026-03-24] Mode-Based Agent Filtering + Per-Agent Prompt Cap for --agents JSON Payload Size

**Context:** The `--agents` JSON payload includes the full system prompt (`prompt` field) for every agent loaded from `.claude/agents/` — totalling ~178 KB across 21 agents. The Claude CLI warns when the payload exceeds 20 KB and may truncate agent definitions. Every non-chat pipeline run triggered the warning. Two strategies were considered: (1) mode-based filtering to load only agents relevant to the current mode (e.g., `plan feature` loads 7 agents, not 21); (2) selectively omit the `prompt` field for project-override agents since the CLI can auto-discover them from `projectFolder/.claude/agents/` at runtime.

**Decision:** Implement **mode-based filtering** (strategy 1) with a secondary **per-agent prompt cap** (8000 bytes). The `buildAgentsJson()` function accepts an optional `mode` parameter and applies an `agentsForMode()` allowlist that maps each pipeline mode to its required agent set. After loading all agents into `agentMap`, a filter step deletes any agent not in the mode's allowlist. Additionally, each agent's `prompt` field is truncated to 8000 bytes before JSON serialization. The runner passes the `mode` string from the IPC invocation to `buildAgentsJson()`.

**Alternatives considered:**
- Omit `prompt` for project-override agents: Requires runtime discovery of which agents exist in `projectFolder/.claude/agents/` vs. `appRoot/.claude/agents/` and conditional JSON construction. Complex; adds an extra I/O pass during buildAgentsJson. Rejected.
- Load all agents but cap individual prompts without mode filtering: Would still include unused agents in the JSON. Rejected.
- Compress or summarize large prompts instead of truncating: Rejected — frontend agent prompts have critical instructions front-loaded; truncation at the tail preserves intent.

**Reason:** Mode-based filtering immediately cuts the agent set from 21 to ≤7 agents per mode, addressing the root cause. The prompt cap is a safeguard so even a single large agent (like gotcha-checker at 20.5 KB) cannot exceed the budget. Together they reduce the payload to well under 20 KB for all standard modes.

**Trade-offs:**
- Mode filtering must be kept in sync with the actual pipeline modes defined in `docs/gotchas/GENERAL.md`. If a new mode is added or an agent is assigned to a mode, `agentsForMode()` must be updated. Mitigated — the mapping is a simple switch statement that is easy to audit.
- Prompt truncation at 8000 bytes may strip important instructions for very large agents. Accepted — large agents are specialized (checkers, reviewers); their core instructions appear in the first ~4 KB. The full prompts are available in `.claude/agents/` in the project.
- Unknown modes fall back to loading all agents (safe default for forward compatibility). No trade-off — preserves behaviour for edge cases.

---

## [2026-03-24] Agent Slots Injected at Runtime (runner) Not at Detection Time (step 3.5)

**Context:** The project agent slots feature allows users to enable custom agents and assign them to pipeline hook points during the import wizard. The design question was when to perform the slot-to-CLI injection: (1) immediately after user confirmation at step 3.5 (eager validation), or (2) deferred to the runner when `agentSlots` are read from `.pipeline/project.json` (lazy evaluation).

**Decision:** Slot injection is **deferred to runtime** in `runner.ts`. The import wizard step 3.5 only confirms and persists `agentSlots` to `.pipeline/project.json`; it does not validate that slot agents are readable. When the user later runs a pipeline, `runner.ts` reads `agentSlots` from the project file and passes them to `buildAgentsJson()`. The build function injects enabled slots as agent entries in the `--agents` JSON payload, annotating their descriptions with `[hook:HOOK_POINT]` metadata. If a slot agent file is missing or unreadable at runtime, that slot is silently skipped (non-fatal) — an empty `agentSlots` array is always valid.

**Alternatives considered:**
- Validate slot agents at step 3.5 before persisting: Would require reading `.claude/agents/` at confirmation time. Rejected — couples the UI layer to file I/O; adds latency to the wizard; complicates error handling in the wizard (what if an agent file is deleted between step 3.5 and run time anyway?).
- Load slot agents into the `--agents` payload at step 3.5 and store the pre-built JSON: Would avoid runtime I/O. Rejected — slots should refer to agents by name so users can edit agent files independently; pre-building the payload ties slots to specific agent versions, defeating this flexibility.
- Require all slot agents to exist and be readable; fail the run if any slot is unreadable: Would guarantee consistency but adds failure modes to the happy path. Rejected — non-fatal skip is more resilient; users can debug missing files via the agent manager UI.

**Reason:** Deferred injection keeps the wizard fast and simple (persist only, no validation), allows slot agents to be edited independently after confirmation, and degrades gracefully if an agent file goes missing. The non-fatal skip design means users always get a valid `--agents` payload, even if some slots cannot be resolved.

**Trade-offs:**
- Slot validation errors are not surfaced until runtime (the run output). This is acceptable — agent file issues are rare; when they occur, the terminal will show which agent(s) failed to load in the runner output or AGENT MANAGER UI.
- Users cannot see at step 3.5 whether a slot agent is actually readable. Accepted — the wizard shows detected agents only; readability is guaranteed by the scanner. If a file is deleted later, that is the user's responsibility (and editing the agent in the AGENT MANAGER is the remedy).

---

## [2026-03-24] Architect Pipeline Gate #1 Requires Explicit Dismissal, No Auto-Chain to Implementation

**Context:** The architect agent performs health analysis on a codebase and reports findings (dead code, unused exports, integrity issues). These findings are sensitive — users should review them before they are committed to the project. The question was whether the architect gate (Gate #1) should automatically chain to an implement run (like plan-feature gates do), or should be review-only.

**Decision:** Architect gates are **review-only**. When the user clicks "ACCEPT FINDINGS" on an architect gate, the gate dismisses and returns to idle — no follow-on `implement feature` or other run is triggered. The findings are reviewed and accepted (or dismissed entirely if the user rejects them), but subsequent action is manual and explicit. The Gate1Bar component detects `mode === 'architect'` and branches the YES button handler to call only `hideGate1()` instead of `setMode() + setPrompt() + hideGate1()`.

**Alternatives considered:**
- Auto-chain to `implement feature` like plan-feature gates do: Would imply the user is ready to implement changes immediately after reviewing findings. Rejected — architect runs are review-only checkpoints; findings should not be automatically queued as implementation tasks.
- Show a follow-up choice: "Accept and continue to plan-fix" or "Accept and return to idle". Rejected — adds complexity to the gate bar UI for a rare interaction; simple dismissal is clearer.
- Use Gate #2 instead of Gate #1: Would place architect in the same category as code reviews. Rejected — Gate #1 is for plan acceptance (blocking path forward); Gate #2 is for code review (blocking application). Architect is neither; it's a governance checkpoint, philosophically closer to Gate #1 in that it is a "proceed or not" decision, but with no forward action implied.
- Emit `[summary]` signals during architect run for gate context: Would provide rich context about findings. Rejected — architect is typically a silent analysis; findings are emitted as `[health]` signals visible in the HEALTH tab. The architect summary is fixed: "Architect findings ready for review — approve to accept, or dismiss to discard."

**Reason:** Architect gates are advisory reviews, not actionable plans. Keeping them review-only (no auto-chain) respects the user's agency — they decide what to do with findings. The fixed summary string keeps the gate simple and signals that this is a different kind of gate from plan-feature.

**Trade-offs:**
- Users must manually dismiss the gate; there is no fast-path auto-advance. This adds a click but makes intent explicit: "I have reviewed the findings."
- The fixed summary does not itemize specific findings found. Users must look at the HEALTH tab to see details. Accepted — detailed findings are in the Health panel, not needed in the gate bar; a concise summary keeps the gate UI clean.
- No back-button from the gate to review the run output. If the gate is dismissed and the user wants to re-examine findings, they must scroll terminal history or re-run. Accepted — findings persist in the HEALTH tab, providing a more durable record than ephemeral terminal output.

---

## [2026-03-24] References Data Layer — Validation at Boundaries, Stale Paths Allowed, Empty Array Omission

**Context:** The project references feature allows users to attach URLs, notes, and file paths to a project for agent context. These references are persisted in `.pipeline/project.json` and must flow through three boundaries: (1) the write handler validates and persists user input, (2) the read handler extracts and validates stored data, (3) the system prompt builder formats references for agent consumption. The design question was: how strictly should validation occur, and should invalid entries fail the entire operation or be silently dropped?

**Decision:** Implement **lenient validation at all boundaries**. (1) In `write-project-json` handler: validate each reference (type is 'url'/'note'/'path', value is non-empty string, label is optional); silently drop invalid entries and write only the valid ones; if all entries are invalid, omit the `references` key from the JSON payload entirely. (2) In `read-project-json` handler: apply identical validation; silently drop invalid entries; omit the field from the return value if the array is empty. (3) In `buildSystemPromptAppend`: apply the same validation rules; only append the `## References` block if at least one valid entry exists. (4) **Allow stale path references**: do not check whether a path exists on the filesystem; agents and users can detect and handle stale paths gracefully. (5) **Strip newlines from label and value** before writing to JSON to prevent YAML/JSON injection via multiline text (defence-in-depth).

**Alternatives considered:**
- Strict validation with rejection: reject the entire write if any entry is invalid. Rejected — this makes the API fragile; users might lose their entire references array if one typo appears. Lenient validation is more resilient.
- Reject stale paths: check filesystem existence before accepting a path reference. Rejected — this couples the data model to the current filesystem state; paths become invalid if projects are moved or shared; agents should handle gracefully instead.
- Preserve invalid entries in JSON and let callers filter: keep invalid entries in the stored JSON. Rejected — this defers validation burden to every consumer; validation at the boundary (the write handler) is cleaner and ensures the JSON always contains valid data.
- Use a separate `references-validation.jsonl` log: track which entries failed validation. Rejected — adds extra files and complexity; silent dropping is acceptable for optional metadata.

**Reason:** Lenient, consistent validation at all boundaries makes the system resilient to user errors and data evolution. Silently dropping invalid entries keeps the API simple and non-blocking. Allowing stale paths acknowledges that references are metadata hints, not live code contracts — agents are smart enough to handle missing paths. The newline stripping is a thin security layer preventing injection attacks without adding user-visible friction.

**Trade-offs:**
- Users will not know if a reference they added failed validation and was dropped (unless they re-read the file). The silent drop is intentional to keep the write handler non-blocking, but it can be surprising. Mitigation: Phase B (wizard/settings integration) should add UI feedback when a reference is rejected.
- Path validation is missing. A user might add `/path/to/missing/folder` and only discover the path is stale when an agent tries to use it. This is acceptable because (1) agents can detect missing paths gracefully, (2) moving projects is a common workflow that would invalidate all paths if validation were strict, and (3) the reference is still useful as documentation even if the path is no longer accessible.
- Newline stripping is silent and may truncate intentional multiline notes. A user adding a multi-sentence note with embedded newlines will see it stored as a single line. Mitigation: the UI (Phase B) should warn users that newlines will be stripped, or accept only single-line input.

---

## [2026-03-23] Fire-and-Forget Async Load of FORGE's Module Registry with Silent Failure

**Context:** When FORGE's UI starts, it needs to load FORGE's own module registry (`.pipeline/modules.json`) to display FORGE's internal modules in ProjectOverviewModal. This is independent data that doesn't block initialization — the app is functional without it (the FORGE MODULES section just shows "No modules loaded"). The challenge was handling a scenario where the IPC handler might be missing (e.g., running against an old FORGE version) without surfacing errors to the user.

**Decision:** Implement a fire-and-forget async pattern in `App.svelte` `onMount`: call `ipc.getForgeModules().then(res => uiStore.setForgeModules(res.modules ?? [])).catch(() => {})`. The `.catch(() => {})` branch is empty and intentional — failures are silently swallowed. The `?? []` guard ensures that even if `res.modules` is undefined, the store receives an empty array instead of undefined. The call fires once at startup (not on every project switch) and does not block any subsequent app initialization logic.

**Alternatives considered:**
- Synchronous load before app startup: Would block the window from rendering until FORGE's metadata is fetched. Rejected — users expect the app to be interactive immediately.
- Store error state and emit a warning chip: Would surface failures to the user as a todo or warning. Rejected — FORGE's own registry is metadata, not critical to project functionality.
- Retry logic with exponential backoff: Adds complexity to non-critical data. Rejected — a single attempt is sufficient; if it fails, the FORGE MODULES section shows empty.
- Skip the `.catch()` and let unhandled rejection warnings appear in the console: Would clutter the console with spurious errors on old builds. The `.catch(() => {})` is necessary to prevent that.

**Reason:** Fire-and-forget async loading is idiomatic in UI applications for non-blocking, non-critical data. The empty catch handler makes the intent explicit: "we acknowledge this can fail, and we do not care." The `?? []` guards the store from receiving unexpected undefined values. This pattern is familiar to JavaScript developers and requires no additional dependencies or state management.

**Trade-offs:**
- If the IPC handler is missing entirely, the FORGE MODULES section will silently show "No modules loaded" instead of surfacing an error. Users on older FORGE versions won't know why. This is acceptable because (1) the section is informational and not blocking, (2) the app still works fully without it, and (3) users are expected to keep FORGE up-to-date.
- The data is loaded once and not refreshed. If FORGE's modules.json is edited at runtime (unlikely but possible in development), the change won't appear in the UI until a reload. Rejected a polling or watch-based refresh — adding that complexity for development-only scenarios is not justified.
- No loading state or spinner is shown while the IPC call is in flight. If the network or filesystem is slow, users won't see the modules populate. This is acceptable because the FORGE MODULES section is collapsed by default; most users will never open it, and a few seconds of latency is unnoticeable for optional metadata.

---

## [2026-03-23] Readonly, Collapsible FORGE Modules Section in ProjectOverviewModal

**Context:** ProjectOverviewModal hosts both FORGE's module registry (read-only metadata) and the Project's module registry (editable). The two registries serve different purposes and have different interaction models: FORGE modules are reference information that users should not modify; project modules are editable CRUD objects. The design question was how to present both registries in the same UI without confusing users about which is editable.

**Decision:** Create two separate, labeled sections in ProjectOverviewModal: a collapsible, readonly "FORGE MODULES" section (collapsed by default) above a collapsible, editable "PROJECT MODULES" section (which replaces the old "MODULES" label). The FORGE section uses the same `.mod-card` visual style as project modules but strips out all edit controls (no card footer, no add-capability button, no delete button). The card list inside the FORGE section is fully readonly — capabilities are shown but not editable. The section header has a "▼ SHOW" / "▲ HIDE" toggle button matching the style of the project-modules section's "+ MODULE" button.

**Alternatives considered:**
- Show FORGE modules in a separate modal/panel: Would require users to switch contexts to compare registries. Rejected — better to show both inline.
- Inline FORGE modules as disabled/grayed-out entries in the main list: Would make the main list longer and harder to scan. Users might accidentally try to edit grayed-out entries. Rejected — clear visual separation is better.
- Always show FORGE modules expanded, project modules collapsed: Inverts user expectations — most users care about their project, not FORGE's internals. Rejected — project modules should be the default.
- Use a tabbed interface (FORGE MODULES tab / PROJECT MODULES tab): Would require switching between tabs; users wanting to compare registries would need to toggle back and forth. Rejected — collapsible sections allow both to be visible simultaneously.
- Use a read-only mode toggle that disables all edits for both sections: Would require users to toggle a mode to switch between viewing and editing. Rejected — we always want the project modules editable.

**Reason:** Side-by-side collapsible sections with clear visual and functional separation (readonly vs editable) make it obvious that the two registries are different and serve different purposes. The FORGE section being collapsed by default keeps the default UI clean and uncluttered for users who don't need FORGE internals. The matching card styles provide visual consistency and make it easy to read either registry without context switching.

**Trade-offs:**
- The FORGE section increases the scrollable content height of ProjectOverviewModal when expanded. If a user with many project modules opens the FORGE section, they'll need to scroll significantly. This is acceptable because (1) the FORGE section is optional and collapsed by default, and (2) users choosing to expand it accept the scroll burden.
- FORGE modules display capabilities but not the same metadata fields as project modules (no id, no createdAt timestamps). This is intentional — FORGE modules are registry data, not project-level instances. Rejected showing FORGE module metadata beyond name, description, notes, and capabilities.
- The section header button is a separate button from the section content, not a click-anywhere toggle. Users must click the button specifically to expand/collapse. This is consistent with the "+ MODULE" button pattern in the project section and provides a clear, clickable target.

---

## [2026-03-23] Race Condition Fix in run-claude via getChild/setChild Accessor Pattern

**Context:** The main process spawns a Claude CLI subprocess via `child_process.spawn()` and stores it in a module-level variable. During the refactoring of `src/main/index.ts` into handler modules, the claude-runner handler's `run-claude` IPC handler was extracted into a separate file. The handler needs to manage the subprocess lifecycle: store it after spawn, retrieve it for streaming events, and clear it on exit. A subtle race condition existed: if a second run was triggered before the previous run's cleanup completed, the stale child reference could be used, causing events to be routed to the wrong process or zombie references to persist. The challenge was ensuring safe access across multiple async operations and module boundaries without introducing locks or promise-based coordination that would block the main thread.

**Decision:** Implement a dual-accessor pattern with a local closure: (1) The claude-runner module exports two functions: `getChild()` (read-only getter) and `setChild(childProcess | null)` (write-only setter) that access a private module-level variable `child`. (2) When `run-claude` spawns a new process, it calls `setChild(spawnedProcess)` immediately after spawn, replacing any stale reference. (3) All subprocess event handlers (stdout, stderr, close) capture the child reference at registration time via `getChild()` within their closure, so they operate on the exact process instance they were attached to, even if `run-claude` triggers a new spawn. (4) On process exit, the close handler calls `setChild(null)` before returning, guaranteeing that the next run finds a clean state. (5) The `stop-claude` handler calls `getChild()` to retrieve the current process and kills it, or returns silently if none exists.

**Alternatives considered:**
- Store the child as part of the renderer's run state: Would require IPC round-trips for every subprocess event; adds latency and complexity. Rejected — main process owns subprocess lifecycle.
- Use a Promise-based queue (async lock): Would serialize runs; prevents parallel session support if added later. Also complicates the streaming event flow. Rejected — accessors are simpler.
- Store all past children in an array keyed by sessionId: Would require complex cleanup logic to evict old sessions; adds memory overhead. Current single-slot approach is sufficient for FORGE's UI model (one active run at a time). Rejected — simpler is better.
- Use Node.js `WeakMap` to track process-to-handler mappings: Adds abstraction without solving the core problem (which process should events route to). Rejected — accessors directly address the ownership question.
- Wrap the child in a Proxy object: Would add indirection without clear benefit; accessors are more transparent. Rejected.

**Reason:** The closure-based accessor pattern is a minimal, understandable solution that exploits JavaScript's lexical scoping. Each event handler captures the exact child reference it was attached to at registration time, so "which process does this event belong to" is answered by the closure, not by looking up a variable. `getChild()` and `setChild()` are explicit synchronous operations with clear ownership semantics — callers know they are reading/writing the single active child, not querying a data structure. Replacing stale references immediately on spawn prevents the zombie-reference window. The pattern is idiomatic in Node.js subprocess management and requires no additional dependencies or synchronization primitives.

**Trade-offs:**
- If multiple runs are initiated rapidly (within milliseconds of each other), the second run's events could briefly arrive before the first run's close handler fires. This is acceptable because (1) FORGE's UI shows one run at a time — the user cannot initiate a second run while the first is active, (2) the close handler runs synchronously in the process's close callback, so the window is extremely narrow, and (3) even if events do cross, the renderer's line-by-line classifier treats extra output as benign noise.
- The module-level variable is not visible outside the handler; callers must use the accessor functions. This is by design — encapsulation prevents accidental direct mutation. It does mean the accessor functions are required; there is no fallback to direct variable access.
- If a handler is called after `setChild(null)` but before the new process is spawned (in the brief gap between cleanup and spawn), `getChild()` returns null and the handler silently no-ops. This is acceptable — lost events in the transition are recoverable (the process has exited, and new output will come from the new process).

---

## [2026-03-22] Dual-Path Wizard Architecture — Template Type vs Stack-Based Selection

**Context:** The project creation wizard originally assumed every project was a code project and routed all projects through stack analysis (TypeScript, Python, C#, etc.). As FORGE expanded to support non-code projects (workflow automation, instructional content), the wizard needed a way to branch users into different flows: code projects benefit from detailed stack analysis and skills generation; non-code projects need simpler template selection without code-specific infrastructure. The question was how to split the wizard cleanly without duplicating state management, and how to select templates for non-code projects without a tech stack concept. Additionally, the wizard originally had separate steps for stack selection (step 2) and skills checking (step 3), which required redundant UI and state management.

**Decision:** Implement a Step 0 type-selection screen (CODE, INSTRUCTIONAL, NON-CODE) that branches the flow into two separate paths: (1) Code path: 0→1→2→3→4 (type → describe → stack+skills → agent slots → create); (2) Non-code path: 0→1→2 (type → describe → create). For non-code projects, use a keyword-based classifier (driven by the project description) to auto-select the template ID (`'power-automate'` or `'instructional'`) instead of requiring manual stack selection. Pass `templateType` to `scaffold-project` to select the correct template directory. Add a new `check-general-md-exists` IPC handler so the wizard can detect when a template already ships `GENERAL.md` (e.g., power-automate) and skip redundant AI generation. **Unified stack+skills picker:** A single shared `StackSkillPicker` component handles both stack selection and skills template checking on wizard step 2 (code path). The component filters to known stacks, validates stack characters server-side, and shows skills status reactively without requiring a separate step. The same component is reused in ProjectOverviewModal for adding stacks to existing projects.

**Alternatives considered:**
- Single unified path with conditional steps: Would require the wizard to show/hide stack-analysis UI based on type, leaving orphaned state fields. More complex state machine. Rejected — explicit branching is clearer.
- User-selectable template picker (dropdown) for non-code path: More flexible but requires users to understand template names and purposes. The keyword classifier auto-selects based on description (e.g., "power automation" → power-automate), reducing user friction. Rejected the dropdown approach.
- Hardcode template per type (e.g., INSTRUCTIONAL always → instructional template): Inflexible if new templates are added or if a description matches multiple templates. Keyword classifier allows future templates without UI changes. Rejected hard-coding.
- Store template selection in `selectedStack` field and pass it as `stack` to `scaffold-project`: Conflates two concepts (tech stack vs template ID). Rejected — better to add an explicit `templateType` parameter to keep the concerns separate.
- Reuse `check-skills-template` for checking GENERAL.md: That handler checks FORGE's own app-bundled templates; it uses a different path pattern. Rejected — add a dedicated `check-general-md-exists` handler to avoid confusion and allow different validation patterns (e.g., user-supplied path traversal guards).

**Reason:** Step 0 type selection is a clear, visible decision point that signals to users "FORGE knows about different project types." Separate flow paths reduce cognitive load — code users see stack research; non-code users see a simpler flow. The keyword classifier bridges the gap: users describe their project naturally (in Step 1), and FORGE classifies it into the right template without asking them to pick from a list. The `templateType` parameter is explicit and forward-compatible: new template types can be added to the allowed list without changing the handler signature. The `check-general-md-exists` handler is necessary because templates vary in what they ship; some (power-automate) include GENERAL.md, others don't (instructional). Skipping AI generation when the template provides it reduces tokens and latency.

**Trade-offs:**
- Users on the non-code path cannot customize the template selection beyond the initial description. If the classifier picks "power-automate" but the user intended "instructional", they must go back to Step 1 and re-describe. No template-picker UI is shown. This is acceptable because (1) descriptions are usually clear enough (e.g., "automate workflows" → power-automate), (2) the wizard is fast; going back is low-friction, and (3) users can always use DIRECT mode to access manual configuration if needed.
- The keyword classifier is rule-based (not ML), so edge cases exist (e.g., "I want to teach Python automation" is ambiguous). The classifier has a default fallback (instructional if no strong signal). This is acceptable for an MVP; can be refined later if edge cases accumulate.
- Non-code projects skip SKILLS.md generation entirely (no coder step). This means no codebase-analysis happens for non-code projects in the wizard. This is by design — non-code projects (e.g., workflow templates) don't have "skills" in the code sense. Rejected adding a non-code equivalent of SKILLS.md for now.
- The code path still always passes `templateType: 'code'`, but a user's stack name (e.g., 'python') is never passed as `templateType`. This ensures code projects always use the base code template, not a hypothetical per-stack template directory. Simplifies the scaffold logic. Rejected per-stack code template variants.
- Stack selection is now restricted to ~45 known stacks; users cannot enter arbitrary free-text stack names. This eliminates the need for separate validation and reduces the attack surface for path-traversal. Accepted — unknown stacks can still be suggested by AI; the filtered list covers nearly all use cases.

---

