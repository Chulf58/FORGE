// stage-labels.js — Derives human-readable labels from a run's stages field.
// Consumed by: mcp/lib/dashboard-state.js

const STAGE_DISPLAY = {
  plan: "planning",
  implement: "implementing",
  review: "reviewing",
  apply: "applying",
  debug: "debugging",
  refactor: "refactoring",
  research: "researching",
};

export function stageLabelFromStages(stages) {
  if (!stages || typeof stages !== "object") return null;
  for (const [key, val] of Object.entries(stages)) {
    if (val && val.status === "running") return STAGE_DISPLAY[key] || key;
  }
  for (const [key, val] of Object.entries(stages)) {
    if (val && val.status === "completed") return STAGE_DISPLAY[key] || key;
  }
  return null;
}
