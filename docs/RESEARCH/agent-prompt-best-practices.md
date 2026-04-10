# Research: Agent Prompt Best Practices

Commissioned research for the "Optimize Tester and Documenter Agent Token Usage" feature and for
general pipeline agent design. Covers five topic areas: model selection, token efficiency,
checklist agents, documentation agents, and prompt structure conventions.

---

## Finding 1: Model Selection — Haiku vs Sonnet for Sub-Agent Tasks

**Summary:**
The industry consensus for multi-agent pipelines is a hybrid: a Sonnet-tier orchestrator that plans
and coordinates, with Haiku-tier workers that execute discrete, bounded sub-tasks. The key routing
signal is cognitive demand — not task size.

**Haiku is appropriate when the task is:**
- Pure transformation (convert, extract, reformat, classify a bounded input)
- A single-step operation with clear, unambiguous inputs and outputs
- Output stays under ~4K tokens
- Latency matters (Haiku: 600–900ms vs Sonnet: 1.1–1.5s)
- The task can tolerate a ~7% higher retry rate (87% first-attempt success vs 94% for Sonnet)

**Sonnet is necessary when:**
- The task requires sustained reasoning across more than ~75 turns or multiple dependent steps
- The instructions are ambiguous or require interpretation under uncertainty
- Error recovery and self-correction within the task are expected
- Output will exceed 4K tokens or requires coherence across long context

**Practical routing rule from production deployments:**
Use Sonnet for planning, Haiku for execution. A hybrid architecture (Sonnet orchestrator +
Haiku sub-agents) achieved 98% end-to-end success while cutting costs 68% compared to
Sonnet-only. For every one Sonnet request, you can run approximately three Haiku requests
at the same cost; on cache reads Haiku is up to 90% cheaper.

**Applied to FORGE's pipeline:**
The tester and documenter agents currently run on `claude-sonnet-4-6`. The tester's job
(read changed files, classify them, generate a checklist) has a measurable Haiku-suitable
profile: it is largely transformative (read → classify → emit items), has a bounded output
ceiling, and does not require deep reasoning under ambiguity. The documenter's board and
features.json steps (Steps 5–6) are pure transformations that could also move to Haiku.
However, the ARCHITECTURE.md and DECISIONS.md update steps require judgment about relevance
and scope — Sonnet is warranted there. A single frontmatter model field limits per-agent
granularity; the more practical near-term win is token reduction rather than model downgrade.

**Source:**
- [Claude Haiku 4.5 vs Sonnet 4.5: Production Agent Tradeoffs](https://mashblog.com/posts/haiku-sonnet)
- [57% Cost Cut: Model Routing for Multi-Agent Systems](https://www.infralovers.com/blog/2026-02-19-ki-agenten-modell-optimierung/)
- [The ultimate LLM agent build guide](https://www.vellum.ai/blog/the-ultimate-llm-agent-build-guide)

---

## Finding 2: Token Efficiency — Conditional Reads and Lazy Context Loading

**Summary:**
The Anthropic engineering team defines the goal as: "the smallest set of high-signal tokens that
maximize the likelihood of your desired outcome." The core technique is just-in-time (JIT) context
loading — load data at the moment it is needed, not in a batch at the start.

**Key patterns:**

**a) Lightweight identifiers over full content**
Pass references (file paths, section headers, anchors) rather than file contents. The agent
fetches the content only if the decision gate (a skip guard) passes. In FORGE agents, this means
reading only the handoff heading and self-review section to derive decision flags before opening
any external doc file.

**b) Conditional reads gated on extracted flags**
The skip guard pattern: extract a boolean (`needs_architecture_update`, `needs_decisions_entry`)
from the primary input (handoff.md), then gate the expensive read behind that flag. If the flag
is false, never open the file. This is already the documented goal for the documenter's Task 6–8.

**c) Progressive disclosure / table of contents reads**
When a file must be referenced, read only the first N lines to locate the insertion point before
deciding whether to read more. For CHANGELOG.md, 20 lines is enough to find the prepend position.
For ARCHITECTURE.md, a Grep for section headers is sufficient to find the target sub-section
before reading its content.

**d) Sub-agent context isolation**
Each sub-agent should start with a clean, narrow context. The agent's entire input should be the
minimal signal it needs — not a dump of everything that might be relevant. Tester only needs the
handoff and the changed source file it names. It should not read TESTING.md cover-to-cover to
find the append point when a `grep -n "^## Test:"` suffices.

**e) Context rot is real**
Studies confirm that retrieval accuracy degrades as context length grows. Keeping context lean
is not just a cost optimisation — it measurably improves output quality. Agents in long contexts
should use compaction (summarise and reinitiate) rather than carrying all prior content.

**Applied to FORGE:**
The documenter currently reads ARCHITECTURE.md, CHANGELOG.md, and DECISIONS.md unconditionally
as part of acting on the `## Files to update` section. Each is a substantial file. The skip
guards in Tasks 6–8 implement the JIT pattern: read handoff, derive flags, only open docs when
flags are true. The CHANGELOG read should be deferred to immediately before the write (Task 9),
and should read only the first 20 lines to find the insertion point.

**Source:**
- [Effective context engineering for AI agents — Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Claude's Context Engineering Secrets — Bojie Li](https://01.me/en/2025/12/context-engineering-from-claude/)
- [LLM Token Optimization: Cut Costs & Latency — Redis](https://redis.io/blog/llm-token-optimization-speed-up-apps/)
- [Cutting Through the Noise: Efficient Context Management — JetBrains Research](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)

---

## Finding 3: Checklist Generation Agents — What Works and What Fails

**Summary:**
Checklist-generating agents fail in predictable ways. The most expensive failure is template
faithfulness: the agent fills every section of a checklist template regardless of whether the
section has applicable items. This produces N/A entries, trivially-true items, and static checks
that a build tool already enforces — all of which inflate token count and reduce signal density.

**Anti-patterns (confirmed across multiple sources):**

**a) Over-templating with mandatory sub-sections**
Forcing the agent to populate `### Happy path`, `### Edge cases`, `### IPC`, `### Error handling`,
`### Regression` for every feature, regardless of whether the feature touches IPC or has edge
cases. Result: placeholder items ("Check that the feature works as expected"), N/A sections, or
fabricated tests that cannot fail.

**b) Static checks that belong in CI**
TypeScript compilation, import resolution, CSS syntax validity, JSON validity, and lint rules
are deterministic — they are true or false independent of user behaviour. Including them in a
manual checklist conflates two different test categories and makes the list longer without
adding manual-testing value. These should be listed in a `## What NOT to test` section so the
agent does not generate them.

**c) Repeating semantically similar items**
Multiple checklist items that test the same code path with slightly different wording. Agents
produce these when the template has multiple sections that map to the same feature area. The
result is a checklist that looks thorough but has redundant coverage. The fix is a flat list
with a hard item cap.

**d) Applying all patterns to all features**
Pattern libraries (terminal, IPC, gate interaction, settings persistence) are valuable references
but should be conditional, not mandatory. A doc-only change should not receive IPC tests.
An IPC feature should not receive terminal output tests unless the feature explicitly touches
terminal output.

**What works:**
- A single flat list capped at a concrete number (10–15 items is the practical range)
- A feature-type classification step before any checklist generation — the agent must classify
  the change before emitting any items
- Items written as "action → expected result" with no sub-section headers
- A skip guard: if the change is doc-only, config-only, or agent-prompt-only, emit one line and
  stop rather than generating a full checklist
- Pattern tables as reference material (when to include) rather than always-included templates

**Source:**
- [Agent Instruction Patterns and Antipatterns — Elements.cloud](https://elements.cloud/blog/agent-instruction-patterns-and-antipatterns-how-to-build-smarter-agents/)
- [How to write a good spec for AI agents — Addy Osmani](https://addyosmani.com/blog/good-spec/)
- [Agentic Code Review: Pattern Matching for AI — Robin Wieruch](https://www.robinwieruch.de/ai-agentic-code-review/)
- [AI Agentic Patterns and Anti-Patterns — Guillaume Laforge](https://glaforge.dev/talks/2025/12/02/ai-agentic-patterns-and-anti-patterns/)

---

## Finding 4: Documentation Agents — Skip Logic and Lazy Reads

**Summary:**
Documentation agents (changelog, architecture, decision log) fail on the same root cause as
tester agents: unconditional reads. The agent opens every doc file it might update before
deciding whether an update is needed. The fix is a two-phase pattern: (1) extract relevance
signals from the primary input, (2) gate each doc file read behind its signal.

**Key practices:**

**a) Derive relevance flags from the primary input before opening secondary files**
The handoff document is the canonical source of truth about what changed. A documentation agent
should read the handoff fully, then derive boolean flags from its content before touching any
other file. Flags should be explicit and named in the prompt:
- `needs_architecture_update`: true if new files, new IPC channels, new stores, or data-flow
  changes are mentioned
- `needs_decisions_entry`: true if a design choice, trade-off, or alternative considered is
  mentioned in the self-review section

This is JIT context applied to documentation — the same principle as lazy-loading in code.

**b) Read only the section you need, not the whole file**
When a flag is true and the file must be read, use Grep to locate the relevant section header
before reading the surrounding lines. For ARCHITECTURE.md, searching for `## IPC` or
`## Folder structure` identifies the exact lines to read, without loading the entire file.
For CHANGELOG.md, the first 20 lines contain the prepend position — reading beyond that is
wasteful.

**c) Defer file reads to immediately before the write step**
Reading CHANGELOG.md at the start of an agent run, before any skip decisions are made, is a
common waste pattern. The read should happen at the point in the prompt where the write is
about to occur. This way, if a prior step fails or is skipped, the read never happens.

**d) Don't document obvious choices**
DECISIONS.md entries should require a genuine decision — a fork where multiple reasonable
alternatives existed and a non-obvious selection was made. The documenter prompt must state
this explicitly and use the `needs_decisions_entry` flag to gate the read. Agents without this
instruction tend to write a DECISIONS entry for every feature regardless of content.

**e) Separate the "read to find insertion point" step from "read to understand content" step**
For append-based docs (CHANGELOG, TESTING), the agent does not need to read prior content —
it only needs the first few lines to find where to prepend. These are two distinct read
purposes that the prompt should distinguish.

**Source:**
- [Effective context engineering for AI agents — Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Why Your AI Agents Need Contextual Documentation — Hyperdev](https://hyperdev.matsuoka.com/p/why-your-ai-agents-need-contextual)
- [LLM Context Management: How to Improve Performance — 16x Engineer](https://eval.16x.engineer/blog/llm-context-management-guide)

---

## Finding 5: Agent Prompt Structure — Conventions for Multi-Step Prompts

**Summary:**
Authoritative sources converge on a consistent structural pattern for multi-step agent prompts.
The pattern consists of: identity declaration, pre-flight validation (step 0), numbered work
steps, skip guards embedded at the top of each conditional step, and a terminating output signal.

**Established conventions:**

**a) Step 0 as a validation / classification gate**
Step 0 should be a pure read-and-classify operation that determines which later steps run. It
reads the minimal required input (the handoff, the feature name, a flag file), extracts key
signals, and sets named boolean flags. It must not perform any write operations. If a hard
precondition fails at Step 0, the agent must emit a specific error signal and stop entirely —
no partial output.

In FORGE: the planner's `## Two-pass behavior` section, the coder's `## Before you start —
plan validity check`, and the documenter's `## Step 0 — Extract context` all follow this pattern
correctly. The gap in the documenter is that Step 0 currently does not derive the skip flags
that guard Steps 2–3.

**b) Skip guards at the top of each conditional section**
Each section that is not always-applicable should begin with an explicit guard: "If [flag] is
false, skip this section entirely — do not read [file]." The guard must be the first instruction
in the section, before any action instructions. This prevents the agent from partially executing
a section before reaching a skip condition buried in the prose.

**c) Numbered steps in dependency order**
Steps must be ordered so that the output of step N is available as input to step N+1. Within
each step, the instruction order should mirror the agent's execution order: read → decide →
act → verify. Interleaving read and write instructions in the same step creates ambiguity about
when reads happen.

**d) Output signals as machine-readable termination markers**
The final line(s) of every agent should be a structured signal in a consistent format, not prose.
FORGE uses `[suggest]`, `[todo]`, `[module]`, `[summary]` for this purpose. The signal line
must be the last content — trailing prose after the signal is consumed by FORGE as terminal
output, not as a signal. Agents that emit the signal mid-response (before finishing work) break
the pipeline.

**e) "What NOT to do" sections improve reliability**
Explicitly listing prohibited behaviours reduces the rate at which agents take forbidden actions
more effectively than relying on the absence of an instruction. Sources confirm that negative
constraints ("never write X", "do not open Y unless flag Z is true") are more reliable when
stated as a dedicated section rather than embedded in prose. Both `coder.md` and `documenter.md`
already follow this pattern.

**f) Block-level optimisation before topology optimisation**
Research on multi-agent system design (MASS framework, arXiv 2502.02533) shows that polishing
individual agent prompts produces larger reliability gains than scaling agent counts or changing
topology. The FORGE approach of maintaining separate, specialised agent files with explicit step
structure is architecturally sound — the highest-leverage improvements are within each file, not
in restructuring the pipeline.

**g) Concrete output contracts over vague goals**
Prompts should specify the exact output format (file to write, line format, signal syntax) at
the end of each step, not just at the end of the entire prompt. When the output format is
defined only at the output-signal section, agents may use different formats mid-task. FORGE's
coder handoff format section and documenter's fenced templates illustrate this correctly.

**Source:**
- [Agents At Work: The 2026 Playbook — Prompt Engineering Org](https://promptengineering.org/agents-at-work-the-2026-playbook-for-building-reliable-agentic-workflows/)
- [Multi-Agent Design: Optimizing Agents with Better Prompts and Topologies — arXiv 2502.02533](https://arxiv.org/html/2502.02533v1)
- [Prompting agents: What works and why — Speakeasy](https://www.speakeasy.com/blog/prompting-agents-what-works-and-why)
- [How to write a good spec for AI agents — Addy Osmani](https://addyosmani.com/blog/good-spec/)
- [Prompt Engineering for Manus 1.5 — Skywork](https://skywork.ai/blog/ai-agent/prompt-engineering-manus-1-5-structure-guardrails-evaluation/)

---

## Summary: Implications for Tester and Documenter

### Tester

| Problem | Best Practice Applied |
|---|---|
| Five mandatory sub-sections regardless of feature type | Feature-type classification at Step 0; skip guard for doc/config-only changes |
| Static CI checks in manual checklist | Explicit `## What NOT to test` section listing TypeScript, lint, import resolution |
| All FORGE-specific pattern templates mandatory | Convert to reference table with "When to include" column; agent only generates items when the subsystem is touched |
| No item cap | Hard cap at 15 items; flat list, no sub-section headers |

### Documenter

| Problem | Best Practice Applied |
|---|---|
| Implicit batch read of all doc files | Derive `needs_architecture_update` and `needs_decisions_entry` flags from handoff before opening any file |
| ARCHITECTURE.md read even when nothing structural changed | Skip guard: "If `needs_architecture_update` is false, skip this section entirely" |
| DECISIONS.md entry written for every feature | Skip guard: "If `needs_decisions_entry` is false, skip this section entirely" |
| CHANGELOG.md read at start of run | Defer to immediately before write; read only first 20 lines for insertion point |
