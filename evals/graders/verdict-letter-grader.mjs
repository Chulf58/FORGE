// Checks output text for verdict letters (APPROVED/REVISE/BLOCK).

/**
 * @param {string} output - agent output text
 * @param {string[]} expectedVerdicts - e.g. ["APPROVED"], ["REVISE"], ["BLOCK"]
 * @returns {{ ok: boolean, matched: string[], missing: string[] }}
 */
export function gradeVerdictLetter(output, expectedVerdicts) {
  const matched = expectedVerdicts.filter((v) => output.includes(v));
  const missing = expectedVerdicts.filter((v) => !output.includes(v));
  return { ok: missing.length === 0, matched, missing };
}
