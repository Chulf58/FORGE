// stage-labels.js — Single source of truth for pipeline step → human-readable label mapping.
// Consumed by: mcp/server.js, mcp/lib/dashboard-state.js, bin/forge-status.js

export const PIPELINE_STAGE_LABELS = {
  plan: {
    "started": "starting", "brainstormer-decision": "brainstorming",
    "planner": "planner", "researcher": "researcher", "gotcha-checker": "gotcha-check",
    "reviewer-triage": "reviewers", "reviewer-boundary": "reviewers", "gate1": "gate1",
  },
  implement: {
    "started": "starting", "setup": "setup",
    "implementation-architect": "scoping slice", "coder-scout": "scout", "coder": "coder",
    "completeness-checker": "completeness",
    "reviewer-triage": "reviewers", "reviewer-boundary": "reviewers", "gate2": "gate2",
  },
  apply: {
    "started": "starting", "setup": "setup",
    "implementer-triage": "triage", "implementer": "implementer",
    "testing": "tests", "documenter": "documenter",
    "worktree-commit": "wt-commit", "merge-back": "merge-back", "done": "done",
  },
  debug: {
    "started": "starting", "debug": "tracing",
    "reviewer-triage": "reviewers", "reviewer-boundary": "reviewers", "gate2": "gate2",
  },
  refactor: {
    "started": "starting", "refactor": "analyzing",
    "reviewer-triage": "reviewers", "reviewer-boundary": "reviewers", "gate2": "gate2",
  },
  research: {
    "started": "starting", "researcher": "researching", "done": "done",
  },
};

export function stageLabelFor(pipelineType, currentStep) {
  if (!currentStep) return null;
  const map = PIPELINE_STAGE_LABELS[pipelineType];
  if (!map) return currentStep;
  return map[currentStep] || currentStep;
}
