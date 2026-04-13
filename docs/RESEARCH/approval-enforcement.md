# Research: Approval-Before-Code Enforcement

## Key facts
- **GSD enforces via state files:** `STATE.md` tracks decisions; plans must pass verification gates before execution phase begins; XML-structured task plans are mandatory precursors to code commits.
- **Compound Engineering uses philosophy + trust:** No technical gates; culture emphasizes 80% planning/review, 20% execution; users *can* skip steps but design nudges them toward Plan → Work → Review order.
- **Both use workflow structure, not code barriers:** GSD is architectural (phase dependencies); Compound is cultural (incentive design). Neither has hook-based or gate-file enforcement like FORGE proposes.
- **FORGE gap:** Both systems rely on agent discipline and file prerequisites, not orchestrator-level state machines preventing tool execution. FORGE's gate-file approach is novel.

## Findings

### Question 1: Does GSD have plan-before-code enforcement?

**Finding:** GSD enforces planning completion through `STATE.md` file tracking and mandatory verification gates. Plans use XML structure and must pass verification agents before the execution phase begins. Each plan becomes a structured `.md` file that precedes code commits.

**Source:** [GSD GitHub repository](https://github.com/gsd-build/get-shit-done), GSD USER-GUIDE.md

**Recommendation:** GSD's enforcement is architectural (phase dependency + file prerequisites), not technical. FORGE's gate-file mechanism is more prescriptive.

---

### Question 2: Does Compound Engineering enforce Plan → Work → Review order?

**Finding:** Compound Engineering does NOT technically enforce the sequence. It uses `/ce:plan`, `/ce:work`, `/ce:review` commands but allows them to be called in any order. The enforcement is cultural: philosophy emphasizes 80% in planning/review, 20% in execution. Users naturally follow the order because it works better, but they could skip steps.

**Source:** [Compound Engineering Plugin](https://github.com/EveryInc/compound-engineering-plugin), Every's documentation

**Recommendation:** Compound Engineering relies on trust and incentive alignment, not barrier enforcement. FORGE's explicit gate mechanism is stricter.

---

### Question 3: Gate files, state machines, or hook-based enforcement?

**Finding:** Neither system uses gate files or hook-based execution barriers. GSD uses file prerequisites (plans must exist before execution) and verification agents. Compound Engineering uses command structure and philosophy. Neither prevents the AI from invoking code-writing tools before planning is complete.

**Source:** Both repositories and documentation

**Recommendation:** FORGE's proposed gate-file enforcement (`.pipeline/gate-pending.json` blocking tool execution) is novel relative to GSD and Compound Engineering.
