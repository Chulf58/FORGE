# Research: Switch Tester, Documenter, and Reviewer-Performance to Haiku Model

## Question: Is `claude-haiku-4-5-20251001` the correct model ID for Haiku 4.5?

**Finding:** Confirmed. The Anthropic models overview page lists the following for Claude Haiku 4.5:

- **Claude API ID (versioned):** `claude-haiku-4-5-20251001`
- **Claude API alias (unversioned):** `claude-haiku-4-5`
- **AWS Bedrock ID:** `anthropic.claude-haiku-4-5-20251001-v1:0`
- **GCP Vertex AI ID:** `claude-haiku-4-5@20251001`

The versioned form `claude-haiku-4-5-20251001` is the stable, snapshot-pinned identifier. It is also exactly the string already in use in the four sibling reviewer agents (`reviewer.md`, `reviewer-logic.md`, `reviewer-safety.md`, `reviewer-style.md`) — confirmed by reading lines 1–10 of each file. There is no ambiguity in the model ID.

**Source:** https://platform.claude.com/docs/en/about-claude/models/overview
Codebase confirmation: `/Users/cuj/Forge/.claude/agents/reviewer.md` line 4, `/Users/cuj/Forge/.claude/agents/reviewer-logic.md` line 4, `/Users/cuj/Forge/.claude/agents/reviewer-safety.md` line 4, `/Users/cuj/Forge/.claude/agents/reviewer-style.md` line 4

**Recommendation:** Use `claude-haiku-4-5-20251001` (versioned form) in all three target agent files. This matches the existing Haiku agents exactly.

---

## Question: Context window and max output for Haiku 4.5 vs Sonnet 4.6 — will any agent hit limits?

**Finding:** Official specs from the Anthropic models overview:

| Model | Context window | Max output |
|-------|---------------|------------|
| Claude Sonnet 4.6 (current) | 1M tokens | 64k tokens |
| Claude Haiku 4.5 | 200k tokens | 64k tokens |

The context window narrows from 1M to 200k. Max output is identical at 64k tokens.

**Assessment per agent:**

**tester.md** — Input is `docs/context/handoff.md` (typically 1–5k tokens) plus a small subset of changed source files. The plan explicitly caps checklist output at 15 items, putting output well under 1k tokens. A 200k context window is more than sufficient. No limit risk.

**documenter.md** — Input is `docs/context/handoff.md` plus lazy-loaded reads of CHANGELOG.md (first 20 lines only), and conditionally ARCHITECTURE.md and DECISIONS.md (single relevant sub-sections located via Grep). The most expensive case — a feature with structural changes requiring all three docs — is still well under 50k tokens of input. Output is 1–4 CHANGELOG entries plus up to two doc updates, under 2k tokens. No limit risk.

**reviewer-performance.md** — Input is either `docs/PLAN.md` or `docs/context/handoff.md`. PLAN.md as of now is 152 lines (~3k tokens). Handoffs are typically 2–6k tokens. Output is a structured verdict block under 500 tokens in most cases. No limit risk.

**Conclusion:** None of the three agents approach the 200k input limit or the 64k output limit under any realistic usage scenario for this codebase. The context window reduction from 1M to 200k has no practical impact.

**Source:** https://platform.claude.com/docs/en/about-claude/models/overview
Agent file analysis: `/Users/cuj/Forge/.claude/agents/tester.md`, `/Users/cuj/Forge/.claude/agents/documenter.md`, `/Users/cuj/Forge/.claude/agents/reviewer-performance.md`

**Recommendation:** No changes to agent prompts are needed to accommodate the smaller context window. Proceed with the model switch.

---

## Question: Quality degradation risks for structured output tasks at Haiku tier?

**Finding:** The four existing Haiku agents in this codebase perform structurally identical tasks to the three being switched:

- `reviewer.md` — reads one handoff, applies a fixed checklist, emits a structured verdict with APPROVED/REVISE/BLOCK. Already on Haiku.
- `reviewer-logic.md` — same pattern: fixed checklist, structured verdict. Already on Haiku.
- `reviewer-safety.md` — same pattern. Already on Haiku.
- `reviewer-style.md` — same pattern. Already on Haiku.

The three switch candidates have the same task profile:
- **tester.md** — reads one handoff, applies conditional rules, writes a flat checklist to one file. Deterministic template-driven output. Equivalent in complexity to `reviewer-logic.md`.
- **documenter.md** — reads one handoff, applies skip flags, prepends a CHANGELOG entry, optionally updates two doc files. Structured-output task with branching but no open-ended reasoning. More steps than a single reviewer, but each step is mechanical.
- **reviewer-performance.md** — reads one document, applies a fixed two-stage checklist (plan-stage or implement-stage), emits a structured verdict. Identical profile to the four sibling reviewers already on Haiku.

**Specific output types and Haiku risk:**

- **Checklist generation (tester):** Haiku 4.5 handles template-following well at this complexity level. The risk of omitting items or misclassifying feature type is low given the explicit guards and examples in the prompt. The cap at 15 items further bounds the task.

- **CHANGELOG writing (documenter):** Single-entry prepend with a 1–3 bullet format. This is low-ambiguity structured output. Risk is minimal.

- **Verdict emission (reviewer-performance):** APPROVED/REVISE/BLOCK verdict with a structured output block. Identical to the existing Haiku reviewers which are already producing this format in production.

- **ARCHITECTURE.md and DECISIONS.md updates (documenter):** These are the highest-complexity output in the set — requires interpreting whether structural changes occurred and writing accurate doc updates. The skip-gate logic (defaulting to false) means Haiku will most often skip these sections entirely, reducing the frequency of complex writes. When they do execute, the Grep-before-read scoping reduces ambiguity. Moderate quality risk exists here if a complex feature is documented, but the default-false flags significantly limit exposure.

- **board.json and features.json writes (documenter):** JSON manipulation with a defined schema. Low risk — Haiku handles mechanical JSON writes reliably.

**Known Haiku 4.5 limitations relevant to this change:**

Haiku 4.5 has a training data cutoff of July 2025 and a reliable knowledge cutoff of February 2025. This is irrelevant to all three agents — none of them require up-to-date world knowledge. They apply rules to content already in the repository.

Haiku 4.5 does not support adaptive thinking. This is irrelevant — none of the three agents use extended or adaptive thinking.

**Source:** https://platform.claude.com/docs/en/about-claude/models/overview
Codebase pattern confirmation: `/Users/cuj/Forge/.claude/agents/reviewer.md`, `/Users/cuj/Forge/.claude/agents/reviewer-logic.md`

**Recommendation:** Quality risk is low for tester and reviewer-performance. Moderate risk exists for documenter's ARCHITECTURE.md and DECISIONS.md update paths, but the skip-gate defaults (both flags default to false) mean these paths execute infrequently. The existing Haiku reviewers are a direct precedent for this task profile. Proceed with the switch for all three agents.

---

## Question: Rollback procedure if quality drops after switching?

**Finding:** The plan already specifies the rollback strategy and it is fully confirmed by the agent file structure. Each of the three agent files has its `model:` field isolated at line 4 in the YAML frontmatter:

- `/Users/cuj/Forge/.claude/agents/tester.md` — line 4: `model: claude-sonnet-4-6`
- `/Users/cuj/Forge/.claude/agents/documenter.md` — line 4: `model: claude-sonnet-4-6`
- `/Users/cuj/Forge/.claude/agents/reviewer-performance.md` — line 4: `model: claude-sonnet-4-6`

Each file is independently revertible by changing that single line back to `claude-sonnet-4-6`. No other files reference these model IDs — confirmed by searching the codebase: the `model:` field in agent YAML frontmatter is consumed by the Claude CLI agent dispatch layer, not by any application source code.

**Quality assessment signals to monitor post-switch:**

- **tester:** Inspect `docs/TESTING.md` after the first apply run. Flags: missing checklist items that should have been caught, doc/config-only guard not firing when it should, or checklist items that are not concrete actions.
- **documenter:** Inspect `docs/CHANGELOG.md` for malformed or missing entries. Inspect `.pipeline/features.json` for incorrect JSON structure. Inspect `.pipeline/board.json` for accidental modification of the `todos[]` array. The ARCHITECTURE.md and DECISIONS.md update paths (when they fire) are the highest-risk output to inspect.
- **reviewer-performance:** Inspect the performance review section in any handoff after the first implementation run. Flags: false BLOCK verdicts on benign patterns, APPROVED verdicts that miss obvious blocking patterns (readFileSync in IPC handlers, unbounded state arrays), or malformed verdict blocks that fail the downstream pipeline parse.

**Per-agent revert is safe** because the agents run sequentially and independently in the apply pipeline — reverting one does not affect the others.

**Source:** Codebase file inspection: `/Users/cuj/Forge/.claude/agents/tester.md` lines 1–10, `/Users/cuj/Forge/.claude/agents/documenter.md` lines 1–10, `/Users/cuj/Forge/.claude/agents/reviewer-performance.md` lines 1–10

**Recommendation:** No changes to the rollback strategy are needed. The plan's described rollback (revert single `model:` line per agent) is correct and sufficient. Document the three quality signals above in the handoff so the post-apply tester knows what to check.
