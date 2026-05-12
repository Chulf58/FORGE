import { unlinkSync } from 'node:fs';

/**
 * consumeGateApproval — remove the gate-pending file after the worker injects
 * the approval resume message.
 *
 * Fail-open: if the file is already absent (double-consume or never written),
 * this function returns silently without throwing.
 *
 * @param {string} gatePath  Absolute path to the gate-pending JSON file.
 * @param {string} gateName  Gate name (e.g. 'gate1', 'gate2') — used in log output.
 */
export function consumeGateApproval(gatePath, gateName) {
  try {
    unlinkSync(gatePath);
    console.error('[forge-worker] cleared gate file after approval: ' + gateName);
  } catch (err) {
    // Fail-open: ENOENT means the file was already gone — not an error.
    if (err.code !== 'ENOENT') {
      console.error('[forge-worker] warning: could not delete gate file ' + gatePath + ': ' + err.message);
    }
  }
}
