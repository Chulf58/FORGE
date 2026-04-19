# api-rest (generated: 2026-03-31)

## Planner

- If the feature calls an external API: add a research task scoped to that API's auth scheme, rate limits, error shapes, and pagination model before any implementation tasks.
- If the feature exposes a new endpoint: plan request validation and error response schema as separate tasks from the happy-path implementation.
- Flag any external API that could be a paid/premium tier as a risk item in the plan.

## Researcher

- For any external API, verify all four before recommending it: authentication scheme (OAuth, API key, mTLS), rate limit (requests per minute and burst), error response shape (consistent? HTTP status codes used correctly?), and pagination model (cursor, offset, page).
- Check whether the API has a sandbox or test mode — production API calls in tests cause billing surprises and test pollution.
- Verify the API's versioning policy: does it use URL versioning (/v1/, /v2/) or headers? What is the deprecation window?
- One-fetch rule: never fetch the same documentation URL more than once per session. Extract everything needed on the first read.

## Coder

- Always validate HTTP status before consuming the response body — a 2xx with a malformed body is a real failure mode.
- Include a timeout on every fetch call — an API that never responds hangs the operation indefinitely without one.
- Never construct query parameters by string concatenation — use URLSearchParams or the language equivalent so values are properly encoded.
- Treat API responses as untrusted input: validate the shape before accessing nested fields.
- For write operations (POST, PUT, PATCH, DELETE): check whether the operation is idempotent. If not, guard against accidental retries.
- Store API keys and tokens in configuration or environment — never in source code or committed files.
- Always handle the non-2xx path explicitly — do not assume success.

## Implementer

- Verify that every fetch call in the handoff has a timeout value.
- Verify that every API key or credential comes from configuration, not a hardcoded string.
- Confirm that error responses from the API are handled and not silently ignored.

## Reviewer-Logic

- Every API call must handle the non-2xx path — BLOCK if the error branch is absent.
- POST/PUT operations that are not idempotent must have a guard against double-submission.
- If the API returns pages, verify the implementation fetches all pages before processing — partial results are a logic bug.
- If the coder accesses a nested response field without null-checking, flag as REVISE.

## Reviewer-Safety

- No credentials, API keys, or tokens in query parameters, logged request bodies, or source files — BLOCK immediately if found.
- CORS headers on new endpoints must not use wildcard if the endpoint handles authenticated data.
- Verify that error responses from external APIs are not forwarded verbatim to the user — they may contain internal server details.

## Reviewer-Performance

- API calls inside render loops or reactive effects without caching or debounce will hammer rate limits — flag any fetch inside a loop or high-frequency event handler.
- Large API responses should be paginated or streamed — flag any response that loads a full unbounded dataset into memory.
