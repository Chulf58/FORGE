// gemini-adapter.js — Google Gemini API adapter (ESM)
// Only for external Gemini calls via forge_call_external.
// Uses Node.js 18+ built-in fetch — no additional HTTP dependencies.
//
// Auth: API key sent via x-goog-api-key header (NOT as a ?key= query param).
// Sending the key in a query param would expose it in proxy/CDN/load-balancer logs.
// Endpoint: generativelanguage.googleapis.com/v1beta/models/{model}:generateContent

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Extracts the retry delay in seconds from a 429 response body.
 * Returns null if not present or unparseable.
 * Gemini encodes it as a string like "40s" in details[].retryDelay.
 */
function parse429RetryDelay(responseText) {
  try {
    const data = JSON.parse(responseText);
    const details = data?.error?.details || [];
    for (const detail of details) {
      if (detail['@type']?.endsWith('RetryInfo') && detail.retryDelay) {
        const match = String(detail.retryDelay).match(/^(\d+)/);
        if (match) return parseInt(match[1], 10);
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Returns a sanitized error message that preserves status and failure class
 * without including raw response body content (which may echo the API key
 * on 401 responses or contain other sensitive material).
 */
function sanitizeErrorMessage(status, responseText) {
  // Extract only the error code/status string from the body — not the full body
  try {
    const data = JSON.parse(responseText);
    const errorStatus = data?.error?.status;
    const errorCode = data?.error?.code;
    if (errorStatus) return `Gemini API error ${status}: ${errorStatus}`;
    if (errorCode) return `Gemini API error ${status}: code ${errorCode}`;
  } catch (_) {}
  // Non-JSON or unparseable — return status only, never raw body
  return `Gemini API error ${status}`;
}

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
  const url = `${GEMINI_BASE}/${modelId}:generateContent`;

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

  const MAX_503_RETRIES = 3;
  let response;
  let responseText;
  let attempt503 = 0;
  let did429Retry = false;

  while (true) {
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error('Gemini request failed (network): ' + err.message);
    }

    try {
      responseText = await response.text();
    } catch (err) {
      throw new Error('Gemini response body read failed: ' + err.message);
    }

    // 503 — transient overload: exponential backoff up to 3 retries (2s, 4s, 8s)
    if (response.status === 503 && attempt503 < MAX_503_RETRIES) {
      const delayMs = 2000 * Math.pow(2, attempt503);
      attempt503++;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      continue;
    }

    // 429 — rate limited: retry once if Retry-After delay is short (per-minute limit, not quota=0)
    if (response.status === 429 && !did429Retry) {
      const retryDelaySec = parse429RetryDelay(responseText);
      if (retryDelaySec !== null && retryDelaySec < 60) {
        did429Retry = true;
        await new Promise(resolve => setTimeout(resolve, retryDelaySec * 1000));
        continue;
      }
    }

    break;
  }

  if (!response.ok) {
    throw new Error(sanitizeErrorMessage(response.status, responseText));
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
