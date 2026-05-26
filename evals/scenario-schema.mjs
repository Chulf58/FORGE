// @covers evals/scenario-schema.mjs
// Scenario schema validator for FORGE agent eval scenarios.
//
// A scenario file describes a single agent's expected behavior given a prompt snapshot.
// The runner (scripts/eval-agent-prompts.mjs) and the graduation helper
// (scripts/eval-from-run.mjs, Task 12) both bind to this schema so writers and readers
// stay in sync — prevents silent drift between the two.
//
// Required fields:
//   agent            string   — agent identifier (e.g. "planner")
//   name             string   — unique scenario name within the agent's directory
//   expected_signals array    — FORGE output signals expected (e.g. "[todo]")
//   expected_artifacts array  — file paths that should exist after the run
//
// Optional fields:
//   description      string
//   prompt_snapshot  string
//   metadata         object

/**
 * Validate a scenario object.
 *
 * @param {unknown} obj - raw parsed scenario (e.g. JSON.parse output)
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateScenario(obj) {
  const errors = [];

  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['scenario must be a plain object'] };
  }

  // Required: agent
  if (!Object.prototype.hasOwnProperty.call(obj, 'agent')) {
    errors.push('missing required field: agent');
  } else if (typeof obj.agent !== 'string' || obj.agent.trim() === '') {
    errors.push('field agent must be a non-empty string');
  }

  // Required: name
  if (!Object.prototype.hasOwnProperty.call(obj, 'name')) {
    errors.push('missing required field: name');
  } else if (typeof obj.name !== 'string' || obj.name.trim() === '') {
    errors.push('field name must be a non-empty string');
  }

  // Required: expected_signals
  if (!Object.prototype.hasOwnProperty.call(obj, 'expected_signals')) {
    errors.push('missing required field: expected_signals');
  } else if (!Array.isArray(obj.expected_signals)) {
    errors.push('field expected_signals must be an array');
  }

  // Required: expected_artifacts
  if (!Object.prototype.hasOwnProperty.call(obj, 'expected_artifacts')) {
    errors.push('missing required field: expected_artifacts');
  } else if (!Array.isArray(obj.expected_artifacts)) {
    errors.push('field expected_artifacts must be an array');
  }

  // Optional: description (if present, must be string)
  if (
    Object.prototype.hasOwnProperty.call(obj, 'description') &&
    typeof obj.description !== 'string'
  ) {
    errors.push('field description must be a string');
  }

  // Optional: prompt_snapshot (if present, must be string)
  if (
    Object.prototype.hasOwnProperty.call(obj, 'prompt_snapshot') &&
    typeof obj.prompt_snapshot !== 'string'
  ) {
    errors.push('field prompt_snapshot must be a string');
  }

  // Optional: metadata (if present, must be plain object)
  if (Object.prototype.hasOwnProperty.call(obj, 'metadata')) {
    if (
      obj.metadata === null ||
      typeof obj.metadata !== 'object' ||
      Array.isArray(obj.metadata)
    ) {
      errors.push('field metadata must be a plain object');
    }
  }

  return { ok: errors.length === 0, errors };
}
