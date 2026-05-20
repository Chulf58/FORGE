// @covers mcp/lib/learnings-extractor.mjs
// Extracts outcome-keyed learnings from completed apply runs and writes them
// to the knowledge base via forge_add_learning.

/**
 * Strips embedded newlines and carriage returns from a title string.
 * Required for YAML/Markdown injection safety (GENERAL.md safety rule).
 *
 * @param {string} str
 * @returns {string}
 */
export function sanitizeTitle(str) {
  return str.replace(/[\r\n]/g, ' ').trim();
}

/**
 * Extracts outcome-keyed learnings from a completed apply run and writes them
 * to the knowledge base. Non-blocking — never throws; apply must continue.
 *
 * @param {object} fixture
 * @param {string} fixture.outcome - 'approved' | 'blocked' | 'debug_resolved'
 * @param {string} fixture.handoffMd - full text of docs/context/handoff.md
 * @param {Array<{name: string, content: string}>} fixture.verdictFiles - reviewer verdict file objects
 * @param {object} fixture.runJson - parsed run.json fields (status, pipelineType, failureReason)
 * @param {string} fixture.cwd - worktree path (not used for learning destination)
 * @param {string} fixture.mainProjectRoot - main project root (passed as projectDir)
 * @param {object} deps
 * @param {(args: object) => Promise<{ok?: boolean, conflict?: boolean}>} deps.forgeAddLearning
 */
export async function runLearningsExtractor(fixture, deps) {
  try {
    const { outcome, handoffMd, verdictFiles, mainProjectRoot } = fixture;
    const { forgeAddLearning } = deps;

    // Derive title from first H1 heading in the handoff
    const titleMatch = handoffMd.match(/^#\s+(.+)$/m);
    let rawTitle = titleMatch ? titleMatch[1] : 'Untitled';
    // Strip "Handoff: " prefix if present
    if (rawTitle.startsWith('Handoff: ')) {
      rawTitle = rawTitle.slice('Handoff: '.length);
    }
    const title = sanitizeTitle(rawTitle);

    // Derive body from full handoff content; append verdict summaries if present
    let body = handoffMd;
    if (verdictFiles && verdictFiles.length > 0) {
      const verdictSummary = verdictFiles
        .map((f) => `\n\n---\n**Verdict file: ${f.name}**\n${f.content}`)
        .join('');
      body = body + verdictSummary;
    }

    // Build call args — always use mainProjectRoot, never cwd
    const args = {
      outcome,
      title,
      body,
      projectDir: mainProjectRoot,
    };

    const result = await forgeAddLearning(args);

    if (result && result.conflict === true) {
      // Duplicate detected — do not attempt further writes
      console.error('[learnings-extractor] CONFLICT_DETECTED — skipping duplicate write');
      return;
    }

    console.error(`[learnings-extractor] learning written: outcome=${outcome}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[learnings-extractor] non-blocking error: ${msg}`);
    // Intentionally swallowed — apply must continue regardless
  }
}
