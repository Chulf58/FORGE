# Per-criterion acceptance tracking

## Problem

Today the FORGE pipeline treats gate approval as all-or-nothing. Planner writes free-form "Verify:" lines per task, reviewers emit holistic APPROVED/REVISE/BLOCK, and coder revision targets the whole handoff. There is no way to accept, defer, or reject individual acceptance criteria.

## Design decisions

### 1. Per-criterion state lives in `criteria.json` per run

Location: `.pipeline/runs/<runId>/criteria.json`

gateState stays lean (it's synced between worktree and main root on every gate operation). A dedicated file in the run directory is the natural home for structured per-criterion state.

Schema:
```json
{
  "criteria": [
    { "id": "AC-1", "task": "1", "text": "PID sidecar written at spawn", "status": "accepted", "reviewer": "reviewer-boundary", "reason": null },
    { "id": "AC-2", "task": "2", "text": "Poison pill detected within 1s", "status": "deferred", "reviewer": null, "reason": "Needs Windows testing" }
  ]
}
```

### 2. Three statuses: accepted / deferred / rejected

- **accepted**: criterion is met
- **deferred**: not met, but moving forward intentionally (auto-creates board TODO)
- **rejected**: not met, blocks approval unless user overrides

in-progress was considered but only relevant during a narrow coder execution window — over-engineered.

### 3. User marks criteria inline in the approval conversation

Zero-friction extension of existing gate flow. The user already says "approve" at gates. Extending to "approve, defer AC-2" is natural. No new skills, no TUI rewrite.

Examples:
- "approve" — all criteria accepted (current behavior, unchanged)
- "approve, defer AC-2" — AC-2 deferred, rest accepted
- "reject AC-3" — blocks gate, AC-3 must be addressed

### 4. Mixed criteria: user decides per approval

Present criteria summary clearly ("3 accepted, 1 deferred, 0 rejected — approve anyway?"), let the human make the call. Matches FORGE's gate philosophy — the user is always in control.

### 5. Deferred criteria auto-create board TODOs

Deferred criteria are added as TODOs on the board, tagged with the original feature name. The observer already surfaces TODOs — deferred criteria get visibility without contaminating other features' plans.

## Scope

### Files to touch

- **Planner agent** (`agents/planner.md`): assign structured AC-IDs per task (AC-1, AC-2, ...)
- **All 5 reviewers** (`agents/reviewer-*.md`): report per-criterion (AC-1: MET, AC-2: NOT_MET + reason)
- **Coder agent** (`agents/coder.md`): revision targets only failed criteria
- **Approve skill** (`skills/approve/SKILL.md`): parse inline criteria marking, write criteria.json
- **Revision loop** (`skills/implement/SKILL.md`): filter by failed criteria on REVISE
- **MCP server** (`mcp/server.js`): criteria.json read/write in gate tools
- **Board** (`mcp/server.js`): auto-create TODOs for deferred criteria

### What stays the same

- "approve" with no criteria spec = all accepted (backwards compatible)
- Gate file format unchanged (criteria.json is separate)
- BLOCK/REVISE/APPROVED reviewer signals unchanged (criteria tracking is additive)

### Multi-session project

This is a large cross-cutting change. Recommended implementation order:
1. Planner AC-ID format + criteria.json schema
2. Reviewer per-criterion output format
3. Approve skill inline parsing + criteria.json writes
4. Coder revision filtering
5. Deferred → TODO auto-creation
