// gemini-adapter.js — Google Gemini API adapter (ESM)
// Only for external Gemini calls via forge_call_external.
// Uses Node.js 18+ built-in fetch — no additional HTTP dependencies.
//
// Gemini API sends the API key as a query parameter, not a Bearer token.
// Endpoint: generativelanguage.googleapis.com/v1beta/models/{model}:generateContent

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Sends a prompt to the Gemini generateContent API.
 *
 * @param {string} prompt - the input text to send
 * @param {string} modelId - model ID (e.g. 'gemini-2.0-flash')
 * @param {string} apiKey - API key resolved from environment variable
 * @param {{ maxTokens?: number }} options
 * @returns {Promise<{ text: string, inputTokens: number, outputTokens: number }>}
 * @throws {Error} on non-2xx status or network failure
 */
export async function callGemini(prompt, modelId, apiKey, options = {}) {
  const url = `${GEMINI_BASE}/${modelId}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      maxOutputTokens: options.maxTokens || 8192,
    },
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error('Gemini request failed (network): ' + err.message);
  }

  let responseText;
  try {
    responseText = await response.text();
  } catch (err) {
    throw new Error('Gemini response body read failed: ' + err.message);
  }

  if (!response.ok) {
    throw new Error('Gemini API error ' + response.status + ': ' + responseText);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    throw new Error('Gemini response JSON parse failed: ' + responseText.slice(0, 200));
  }

  // Extract text from the first candidate's first part.
  const candidates = data.candidates || [];
  const firstCandidate = candidates[0];
  const text = firstCandidate?.content?.parts?.[0]?.text ?? '';

  // Usage metadata.
  const usage = data.usageMetadata || {};

  return {
    text,
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
  };
}
