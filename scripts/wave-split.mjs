/**
 * wave-split.mjs — TDD wave-split guard utilities.
 *
 * Provides helpers that enforce the red-phase invariant: failing tests must
 * remain failing until source code is written. If a test file exits 0 before
 * the implementation wave begins, the red-phase contract is violated and the
 * pipeline should abort.
 */

/**
 * Checks whether the red-phase invariant has been violated.
 *
 * @param {{ exitCode: number, testFile: string }} opts
 * @returns {{ aborted: boolean, reason: string | null }}
 */
export function redPhaseAbort({ exitCode, testFile }) {
  if (exitCode === 0) {
    return {
      aborted: true,
      reason: `Test file ${testFile} passed without implementation — wave-split red bar invariant violated`,
    };
  }
  return { aborted: false, reason: null };
}
