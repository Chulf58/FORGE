# CLAUDE.md Audit — Trim to ≤150 lines

Audited against `docs/gotchas/GENERAL.md` (439 lines). GENERAL.md is loaded into every session via `@docs/gotchas/GENERAL.md` at CLAUDE.md L110, so anything duplicated there costs tokens twice.

---

| Rule / Section | Line range | Verdict | Rationale | Proposed replacement |
|---|---|---|---|---|
| Anti-speculation rule | L1–4 | **keep** | Structurally critical, must be first | Unchanged |
| Stack | L11–16 | **keep** | Concise, useful navigation | Unchanged |
| Key source locations table | L18–32 | **keep** | Navigation anchor, not prose | Unchanged |
| How the plugin works | L34–43 | **trim** | 10-line prose explaining agent/hook loading — orientation only, not a rule; no equivalent in GENERAL.md | Collapse to 2 imperative lines |
| File categories — plugin files | L46–51 | **trim** | GENERAL.md L7–17 has an equivalent "Plugin structure" table. Redundant as standalone list. | Drop plugin files list; keep per-project list in collapsed form |
| File categories — per-project files | L53–61 | **trim** | GENERAL.md L119–131 has the per-project files list (more complete, includes `run-active.json`, `gate-pending.json`). Redundant here. | Collapse to pointer: "Per-project files documented in GENERAL.md" |
| Pipeline types and agent sets | L63–77 | **keep** | Load-bearing table; determines which pipeline to invoke | Unchanged |
| Pipeline modes | L79–91 | **keep** | Load-bearing table; controls reviewer dispatch | Unchanged |
| Signal protocol | L93–106 | **delete** | GENERAL.md L174–189 is a superset (adds `[task-block]`, `[solution-hit]`, `[promote-gotcha]`). Loaded via @-include. Double-loading costs tokens. | Remove from CLAUDE.md; GENERAL.md is authoritative |
| Stack rules @include | L108–110 | **keep** | The @-include mechanism that loads GENERAL.md | Unchanged |
| Working on this plugin | L112–119 | **trim** | 8-line list of edit/test/restart advice — useful but over-explained | Collapse to 3 bullets |
| End-of-session protocol | L121–129 | **trim** | 3 steps with sub-headers — keep the 3 steps, drop the `Step N —` formatting overhead | Compress to a numbered list |
| Task approach protocol — Step 1 (read task) | L133–136 | **trim** | One sentence of prose wrapping one bullet; merge into Step 2 | Remove standalone step; fold into assessment |
| Task approach protocol — Step 2 (assess) | L138–139 | **trim** | One line; merge with Step 1 | Fold into intro sentence |
| Task approach protocol — mandatory agents + risk surface | L141–160 | **keep** | Load-bearing; risk surface list is what drives safety reviewer inclusion | Unchanged |
| Task approach protocol — LEAN-lite skip rule | L162–169 | **trim** | 8 lines; final sentence about plan pipeline deferral is low-value commentary | Keep bullets, drop trailing commentary sentence |
| Task approach protocol — contextual agents table | L171–180 | **keep** | Load-bearing; drives agent team selection | Unchanged |
| Task approach protocol — Step 4 pipeline/mode | L182–195 | **keep** | Load-bearing; the pipeline selection table and boundaries | Unchanged |
| Task approach protocol — Step 5 present and wait | L197–204 | **keep** | Critical behavioral gate — preserve as-is | Unchanged |
| Pipeline docs | L206–212 | **delete** | Pure duplicate of Key source locations table above (L18–32). Adds no new information. | Remove entirely |
| Tool efficiency table | L214–234 | **keep** | Load-bearing; bash-guard enforces a subset; table is primary guidance | Unchanged |
| Common FORGE data lookups — worked examples | L236–245 | **trim** | 10 lines of prose examples restating the table above. The examples add little beyond the table. | Remove prose examples |
| Hard rules (no subagents for file reads) | L247–249 | **keep** | Critical behavioral constraint; kept for emphasis | Unchanged |

---

## Line budget projection

| Section | Current lines | After trim |
|---|---|---|
| Anti-speculation rule | 5 | 5 |
| Stack | 6 | 6 |
| Key source locations | 14 | 14 |
| How the plugin works | 10 | 2 |
| File categories | 18 | 4 |
| Pipeline types | 15 | 15 |
| Pipeline modes | 12 | 12 |
| Signal protocol | 14 | 0 (deleted) |
| @include | 3 | 3 |
| Working on this plugin | 8 | 4 |
| End-of-session protocol | 9 | 5 |
| Task approach protocol | 74 | 58 |
| Pipeline docs | 8 | 0 (deleted) |
| Tool efficiency | 21 | 21 |
| Worked examples | 10 | 0 (trimmed) |
| Hard rules | 3 | 3 |
| **Total** | **~250** | **~152** |

Close to target. Further trim: LEAN-lite skip rule trailing sentence (-2), Step 1/2 merge (-3) brings to ~147.
