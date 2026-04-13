// openai-adapter.js — OpenAI Responses API adapter (ESM)
// Only for external OpenAI calls. Anthropic models are handled via agent frontmatter.
// Uses Node.js 18+ built-in fetch — no additional HTTP dependencies.

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/**
 * Sends a prompt to the OpenAI Responses API.
 *
 * @param {string} prompt - the input text to send
 * @param {string} modelId - model ID (e.g. 'codex-mini-latest')
 * @param {string} apiKey - API key resolved from environment variable
 * @param {{ maxTokens?: number }} options
 * @returns {Promise<{ text: string, inputTokens: number, outputTokens: number }>}
 * @throws {Error} on non-2xx status or network failure
 */
export async function callOpenAI(prompt, modelId, apiKey, options = {}) {
  const body = {
    model: modelId,
    input: prompt,
    max_output_tokens: options.maxTokens || 4096,
  };

  let response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network-level failure (DNS, timeout, etc.)
    throw new Error('OpenAI request failed (network): ' + err.message);
  }

  let responseText;
  try {
    responseText = await response.text();
  } catch (err) {
    throw new Error('OpenAI response body read failed: ' + err.message);
  }

  if (!response.ok) {
    // Include status code in message so callers can detect 401/429
    throw new Error(
      'OpenAI API error ' + response.status + ': ' + responseText,
    );
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    throw new Error('OpenAI response JSON parse failed: ' + responseText.slice(0, 200));
  }

  return {
    text: data.output?.[0]?.content?.[0]?.text ?? (typeof data.output === 'string' ? data.output : ''),
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}
