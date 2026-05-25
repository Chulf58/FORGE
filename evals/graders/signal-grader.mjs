// Checks output text for presence of expected signals.

/**
 * @param {string} output - agent output text
 * @param {string[]} expectedSignals - signals to look for, e.g. ["[todo]", "[reviewer-verdict]"]
 * @returns {{ ok: boolean, matched: string[], missing: string[] }}
 */
export function gradeSignals(output, expectedSignals) {
  const matched = expectedSignals.filter((s) => output.includes(s));
  const missing = expectedSignals.filter((s) => !output.includes(s));
  return { ok: missing.length === 0, matched, missing };
}
