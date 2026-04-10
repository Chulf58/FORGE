# Research: Rule Injection Architecture for Multi-Agent Coding Pipelines

## Question 1: What is the optimal chunk size and rule density for injecting structured knowledge?

**Finding:** RAG research identifies chunk sizes of 250–512 tokens as optimal, with practical guidance showing two competing pressures:
- **Fact-dense queries** benefit from smaller chunks (128–256 tokens, ~1000 characters)
- **Reasoning tasks** prefer larger chunks (256–512 tokens)
- **For coding agents specifically**, append domain-level metadata (file paths, section headers, stack-specific gotchas) to each rule block to boost comprehension from baseline ~50% to 72–75%

However, chunking advice from RAG literature does not directly transfer to system prompts. The key constraint is **context window saturation**, not chunk size: LLMs struggle with the "lost in the middle" problem (detailed below), so the rule density question is less about individual chunk size and more about **total rule load and positioning within the prompt**.

**Critical insight:** Even with large context windows, inserting too many rules causes performance degradation. Research indicates agents retain **semantic comprehension** ("what" a rule is) but lose **spatial awareness** ("where" it sits in the prompt) as density increases.

**Recommendation:** For FORGE's architecture, aim for **role-specific rule blocks of 300–500 tokens each** (roughly 80–150 lines of markdown with explanation). Group related rules by agent role, not by technical domain. Place critical safety/IPC rules at the **beginning and end** of agent prompts to combat lost-in-the-middle.

---

## Question 2: How do tools like Cursor (.cursorrules), GitHub Copilot, Windsurf, and Aider structure project rules?

**Finding:** Industry has converged on **multi-file, location-scoped, metadata-driven** rule organization instead of monolithic files. Key patterns:

**Cursor (.cursorrules):**
- Original: single `.cursorrules` file at project root
- Current best practice: `.cursor/rules/` directory with separate files (~500 lines max per file)
- Each file has frontmatter describing scope (description, globs, target file patterns)
- Rules apply based on file type/location; agents selectively load relevant ones

**GitHub Copilot:**
- Single `.github/copilot-instructions.md` file
- Markdown-based natural language instructions
- Applied at repo/org level; copilot determines relevance via file context
- Less sophisticated scoping than Cursor (relevance depends on Copilot's heuristics)

**Windsurf (Codeium):**
- Global rules in project root
- **AGENTS.md** files in directories for location-specific knowledge (this is Windsurf's "location-based scoping")
- Combines directory-specific rules with file-type-specific context
- Supports persistent Memories for session state
- **Workflow** files for multi-agent task coordination

**Aider:**
- Uses Skills as modular knowledge packages
- Each skill is a `.md` file with instructions, examples, and custom commands
- Skills are dynamically loaded when agent detects relevance (not always-on)
- Works across Claude Code, Cursor, Windsurf, Aider itself

**Universal pattern:** Modern tools reject monolithic "all rules in one file" in favour of **role-scoped, directory-scoped, or dynamically-loaded** rule sets.

**Recommendation:** FORGE's `docs/gotchas/SKILLS.md` follows the right pattern (role-specific, per-stack), but consider adding a secondary layer:
- Move general platform constraints (`GENERAL.md`) to a stable reference section
- Expand `SKILLS.md` with subsections for each agent role (`## Researcher`, `## Coder`, `## Reviewer`, etc.)
- Future: consider agent-specific `.md` files in `.claude/agents/` that embed critical rules directly in agent prompts (not currently done)

---

## Question 3: Does evidence show that smaller, focused rule chunks outperform large all-in-one files?

**Finding:** Yes, with important caveats:

**Monolithic vs. Modular trade-offs:**
- **Monolithic** ("mega-prompt" era): single large system prompt with all rules
  - Advantage: complete context always available
  - Disadvantage: high token cost on every inference, agents drift due to conflicting signals, lost-in-middle problem worsens

- **Modular** (Agent Skills / progressive disclosure): role-specific or task-specific rule files
  - Advantage: conditional loading (only include rules relevant to the agent's role), lower token overhead, clearer signal-to-noise ratio
  - Disadvantage: adds orchestration complexity, requires discovery logic to activate the right rule set
  - **Evidence:** Anthropic's transition to Agent Skills, OpenAI's function-scoped instructions, Microsoft's multi-turn task decomposition all converge on modular

**Specific evidence on context density:**
The Stanford "Lost in the Middle" study (2023, updated 2024) found that when rule density increases:
- Semantic understanding (what a rule means) is preserved
- Spatial awareness (where in the context a rule lives) degrades sharply
- Middle-positioned rules are recalled ~40% as often as rules at start/end

**Practitioner reports (2025–2026):** Developers using Cursor, Windsurf, and Aider report better agent behavior when rules are:
1. Split by role (planner rules ≠ coder rules ≠ reviewer rules)
2. Kept under 500 lines per file
3. Placed in files the agent reads first (not buried in appendices)

**Recommendation:** FORGE's current architecture is **on the right track** by separating `GENERAL.md` (platform constraints) from `SKILLS.md` (stack-specific patterns). However, given FORGE's 30+ agents with distinct responsibilities, consider:
- Each agent reads its own role section from `SKILLS.md` (already done)
- Add a secondary index/metadata layer so agents know which sections to prioritize
- Confirm critical safety rules (path traversal, process boundaries, IPC quadruple) appear in **first 200 tokens** of every relevant agent's system prompt

---

## Question 4: What is the "lost in the middle" problem and how does it apply to rule injection?

**Finding:** Comprehensive, well-documented phenomenon:

**Core discovery (Liu et al., 2023 Stanford study):**
When relevant information is placed in the middle of a long context window, performance drops significantly—even for models explicitly trained for long contexts. Empirical results:
- Information at **beginning** of context: ~90% recall
- Information in **middle** of context: ~40–50% recall
- Information at **end** of context: ~80–90% recall

**Why it matters for rule injection:**
- If FORGE loads 30+ agents' gotchas into a single system prompt and places Svelte 5 rules at line 200 (middle), the model may miss them
- Conversely, critical path-traversal safety rules placed at the beginning are retained reliably
- This effect **worsens with increasing context density** — as more rules are added, the model's internal spatial mapping of where things are stored becomes fragile

**Variations by model:**
- Newer models (Claude 3.5 Sonnet, GPT-4o) show better but not perfect resistance to lost-in-middle
- Effect still observable; not eliminated by increased context window size alone
- Mitigation strategies: retrieval augmentation (only load needed rules), positional emphasis (critical rules at start/end), structured indexing (explicit rule table of contents)

**Application to FORGE's 30+ agents:**
If all agent rules were merged into a single mega-prompt:
- Planner rules in middle sections would be partially forgotten
- Reviewer-specific checklist at line 500 of 1200 would degrade in reliability
- **Current approach** (separate agent `.md` files, role-scoped `SKILLS.md` sections) mitigates this by keeping each agent's context window smaller

**Recommendation:** Validate that critical rules appear in the **first and last sections** of agent prompts:
1. Safety rules (path traversal, process boundaries, no `any` types) — top 5% of prompt
2. Domain rules (IPC quadruple, Svelte 5 runes, signal protocol) — top 15% of prompt
3. Implementation patterns — middle sections (can afford slight degradation)
4. Gotchas and edge cases — end sections or summary table (high contrast helps retention)

---

## Question 5: Is there practitioner writing about structuring skills/knowledge for multi-agent pipelines?

**Finding:** Emerging field with several high-signal sources:

**Academic/research sources (2024–2026):**
- **Micheal Lanham** (Substack: "Agent Skills: The Architectural Shift from Mega-Prompts to Progressive Disclosure") — argues that Skills represent a fundamental architectural shift away from monolithic prompts toward conditional, role-scoped knowledge injection. Emphasizes **metadata layer for discovery** + **detailed instructions for activation** + **runtime resources** as a three-tier hierarchy.
- **Muhammad Shafat (Medium, 2026: "Stop Engineering Prompts, Start Engineering Context")** — advocates for "context engineering" as a discipline: treating context as a finite, structured resource rather than a prompt dump. Recommends role separation and agent-specific resource passing.
- **Anthropic's Agent Skills Blog** (2025) — positions Skills as "instructions stored in markdown files" with dynamic loading. Notes they are fundamentally insecure (prompt injection risk) but enable modularity. Recommends separate Skills per capability domain.

**Practitioner reports (blogs, GitHub discussions, 2025–2026):**
- **Cursor's agent-best-practices blog**: Emphasizes **iteration over optimization** ("add rules only when the agent repeatedly makes the same mistake") and **specificity over generality** ("add token-usage context to the rule: which files, what constraints, how to measure success").
- **Windsurf documentation**: Documents the AGENTS.md location-scoping pattern as mature best practice for directory/module-specific knowledge.
- **GitHub Copilot community discussions**: Developers report monolithic `.github/copilot-instructions.md` files (>1000 lines) produce worse results than role-separated AGENTS.md + .cursorrules combinations in mixed tooling setups.

**Key consensus:**
1. **Specialization > generality**: agents perform better with focused rule sets for their role than with all-in-one knowledge bases
2. **Progressive disclosure**: load rules conditionally based on file context/agent intent, not all at once
3. **Metadata-driven discovery**: rules should be discoverable via file location, globs, or explicit agent routing, not hidden in prose
4. **Role-agent alignment**: each agent should have a clear role (planner, coder, reviewer, debugger) and receive only rules for that role
5. **Iterative refinement**: start with minimal rules; add only when agents demonstrate repeated mistakes, not preemptively

**Recommendation:** FORGE's pipeline architecture already implements most of these:
- Role-scoped agents (planner, coder, reviewer roles are clearly separated)
- SKILLS.md provides stack-specific knowledge indexed by agent role
- docs/gotchas/ provides platform-level constraints separate from stack-specific patterns
- Agent prompt files in `.claude/agents/` are role-specific

**Gap:** No automated discovery/routing layer yet. Consider adding metadata (YAML frontmatter) to SKILLS.md sections so an orchestrator tool could:
- Extract which rules apply to which agent roles
- Measure rule density per agent
- Flag rules that should be moved to embedded agent prompt vs. external skill files

---

## Synthesis: Design Principles for FORGE's Rule Injection

### 1. Chunk size and density
- Aim for **300–500 tokens per role-specific rule block** (roughly 80–150 lines of documented rules)
- Prioritize **metadata-driven organization** (YAML frontmatter, clear section headers) over prose narratives
- Cap total rules per agent at **1000–1500 tokens** to maintain signal-to-noise ratio

### 2. Structure (monolithic vs. modular)
- **Reject monolithic**: FORGE's current separation of `GENERAL.md` and `SKILLS.md` is correct
- **Extend modularity**: agent-specific sections within SKILLS.md are good; consider embedding 2–3 critical rules directly in agent prompts for safety constraints
- **Metadata layer**: add YAML frontmatter to SKILLS.md sections for automated discovery (future tooling)

### 3. Positioning for lost-in-the-middle
- **Top 5% of agent prompts**: safety rules (path traversal, no `any`, process boundaries)
- **Top 15% of agent prompts**: domain rules critical to the agent's role (IPC quadruple for coder; state ownership for component engineers)
- **Middle sections**: implementation patterns, code style, examples
- **End sections**: gotchas, edge cases, uncommon constraints

### 4. Role-scoped knowledge
- Current approach is sound: each agent has a defined role (planner, coder, researcher, reviewer)
- Each role section in SKILLS.md is read by agents in that role
- No evidence suggests that reading "unrelated" rules helps; focus > breadth

### 5. Multi-agent pipeline coordination
- Pass context **explicitly and structurally**, not by loading everything into every agent
- Researcher writes to `docs/RESEARCH/`, which coder and reviewers read — no need to embed research context in coder prompts
- Planner writes to `docs/PLAN.md`, which implementer reads — not loaded into implementer prompt
- **Token efficiency**: each agent carries only its own role rules + minimal cross-agent coordination rules

### 6. Iterative refinement over preemptive optimization
- Current SKILLS.md is well-tuned; avoid adding rules speculatively
- When agents make repeated mistakes, isolate the failure (is it lack of domain knowledge, unclear formatting, or lost-in-middle positioning?) before adding a new rule
- Track which rules are most effective (use observer logs, audits)

---

## Actionable Next Steps

1. **Audit current rule density**: count tokens in SKILLS.md sections per agent role; target ~400 tokens/role as ideal
2. **Validate positioning**: move safety/critical rules to top of each role section if not already there
3. **Add metadata layer** (YAML frontmatter) to SKILLS.md sections for future automated discovery
4. **Test lost-in-middle mitigation**: run a small experiment with a rule moved from middle to top of a SKILLS.md section; measure agent behavior change
5. **Document rule retirement**: when a rule proves unnecessary (agents no longer make the mistake it addresses), mark it as deprecated and remove it quarterly to keep SKILLS.md lean

---

## Sources

- [RAG Chunking Strategy Guide](https://gpt-trainer.com/blog/rag+chunking+strategy)
- [Evaluating Ideal Chunk Size](https://www.llamaindex.ai/blog/evaluating-the-ideal-chunk-size-for-a-rag-system-using-llamaindex-6207e5d3fec5)
- [Cursor Documentation on Rules](https://cursor.com/docs/rules)
- [Windsurf AGENTS.md Docs](https://docs.windsurf.com/windsurf/cascade/agents-md)
- [Agent Rules vs Copilot Instructions Comparison](https://www.agentrulegen.com/guides/cursorrules-vs-claude-md)
- [Agent Skills Standard Overview](https://www.datacamp.com/blog/agent-skills)
- [Lost in the Middle: How Language Models Use Long Contexts (MIT Press)](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00638/119630/Lost-in-the-Middle-How-Language-Models-Use-Long)
- [What Works for "Lost-in-the-Middle" in LLMs?](https://arxiv.org/html/2511.13900v1)
- [Long Context Windows are Deceptive](https://dev.to/llmware/why-long-context-windows-for-llms-can-be-deceptive-lost-in-the-middle-problem-oj2/)
- [Agent Skills: The Shift from Mega-Prompts to Progressive Disclosure](https://micheallanham.substack.com/p/agent-skills-the-architectural-shift)
- [Stop Engineering Prompts, Start Engineering Context](https://medium.com/@muhammad.shafat/stop-engineering-prompts-start-engineering-context-a-guide-to-the-agent-skills-standard-bc8e2056f40a)
- [The Great AI Agent Configuration Confusion](https://satinathmondal.medium.com/the-great-ai-agent-configuration-confusion-agents-md-skill-md-and-what-s-next-976f130f6021)
- [Claude's Modular Mind: Agent Skills](https://www.ikangai.com/claudes-modular-mind-how-anthropics-agent-skills-redefine-context-in-ai-systems/)
- [Agent Skills for Large Language Models](https://arxiv.org/html/2602.12430v3)
- [Best Practices for Coding with Agents (Cursor)](https://cursor.com/blog/agent-best-practices)
- [Multi-Agent Orchestration Guide 2026](https://www.codebridge.tech/articles/mastering-multi-agent-orchestration-coordination-is-the-new-scale-frontier)
