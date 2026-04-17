// openai-adapter.js — OpenAI Responses API adapter (ESM)
// Only for external OpenAI calls. Anthropic models are handled via agent frontmatter.
// Uses Node.js 18+ built-in fetch — no additional HTTP dependencies.
//
// Supports:
//   reasoning_effort — optional; passed as reasoning.effort to the Responses API
//                      only when explicitly set; sensible starting value is "medium"
//   429 retry        — honors Retry-After header; retries once if delay < 60s
//   token fields     — uses Responses API field names (input_tokens / output_tokens)

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/**
 * Parses the Retry-After delay in seconds from a 429 response.
 * Checks the Retry-After header first (OpenAI standard), then falls back to a
 * fixed default so the caller always gets a usable number.
 * Returns null when the delay is too long to be worth retrying.
 *
 * @param {Response} response - fetch Response object
 * @returns {number|null} seconds to wait, or null if not retryable
 */
function parse429RetryDelay(response) {
  const header = response.headers?.get?.('Retry-After');
  if (header !== null && header !== undefined) {
    const secs = parseInt(header, 10);
    if (!isNaN(secs)) return secs < 60 ? secs : null;
  }
  // No header — use a conservative fixed delay and let the caller retry once
  return 10;
}

/**
 * Sends a prompt to the OpenAI Responses API.
 *
 * @param {string} prompt - the input text to send
 * @param {string} modelId - model ID (e.g. 'gpt-5.4', 'gpt-4.1')
 * @param {string} apiKey - API key resolved from environment variable
 * @param {{ maxTokens?: number, reasoningEffort?: 'none'|'low'|'medium'|'high'|'xhigh' }} options
 * @returns {Promise<{ text: string, inputTokens: number, outputTokens: number, reasoningTokens: number }>}
 * @throws {Error} on non-2xx status or network failure
 */
export async function callOpenAI(prompt, modelId, apiKey, options = {}) {
  const body = {
    model: modelId,
    input: prompt,
    max_output_tokens: options.maxTokens || 4096,
  };

  // Include reasoning effort only when explicitly requested — avoids errors on
  // non-reasoning models that do not accept this parameter
  if (options.reasoningEffort != null) {
    body.reasoning = { effort: options.reasoningEffort };
  }

  let response;
  let responseText;
  let did429Retry = false;

  while (true) {
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
      throw new Error('OpenAI request failed (network): ' + err.message);
    }

    try {
      responseText = await response.text();
    } catch (err) {
      throw new Error('OpenAI response body read failed: ' + err.message);
    }

    // 429 — rate limited: retry once if Retry-After delay is short
    if (response.status === 429 && !did429Retry) {
      const delaySec = parse429RetryDelay(response);
      if (delaySec !== null) {
        did429Retry = true;
        await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
        continue;
      }
    }

    break;
  }

  if (!response.ok) {
    throw new Error('OpenAI API error ' + response.status + ': ' + responseText);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    throw new Error('OpenAI response JSON parse failed: ' + responseText.slice(0, 200));
  }

  // Responses API: output is an array of message objects; text lives in content[0].text
  const text = data.output?.[0]?.content?.[0]?.text ?? '';

  // Responses API uses input_tokens / output_tokens (not Chat Completions prompt_tokens / completion_tokens)
  const usage = data.usage || {};
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0;

  return { text, inputTokens, outputTokens, reasoningTokens };
}
