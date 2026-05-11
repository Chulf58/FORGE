// Proxy for tdd-guard's resolveTestFile() — its `<name>.test.{js,mjs}`
// convention doesn't match our `<name>-*-test.{js,mjs}` runner convention.
// Re-runs the real subagent-stop tests so the guard finds a failing test
// when one exists in the dash-suffix file.
//
// Long-term fix: extend tdd-guard.js to accept the dash-suffix pattern.
import './subagent-stop-verdict-test.js';
