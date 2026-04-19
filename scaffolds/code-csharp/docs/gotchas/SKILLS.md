## Planner

### C# / .NET

- `.csproj` file changes (adding packages, changing target framework) require a restore step. Plan `dotnet restore` as a dependency for any task that adds a NuGet reference.
- Namespace hierarchy must match folder hierarchy — plan folder creation and namespace renaming as a single task.
- Async controller actions in ASP.NET Core: plan the return type change (`Task<IActionResult>`) alongside the implementation change.

## Coder

### C# / .NET

- `async Task` methods that have no `await` inside them compile but generate a warning and may produce surprising behavior. Every `async` method must have at least one `await`.
- `using` declarations (C# 8+) vs `using` statements — the declaration form (`using var x = ...`) disposes at end of scope; the statement form (`using (var x = ...) {}`) disposes at end of block. Be explicit about which is needed.
- `IDisposable` implementations: always call `GC.SuppressFinalize(this)` at the end of `Dispose()` if a finalizer is present.
- `string.IsNullOrWhiteSpace()` instead of `string.IsNullOrEmpty()` — whitespace-only strings are almost always invalid input.

## Implementer

### C# / .NET

- NuGet package versions must be pinned in `.csproj` — floating versions (`*`) cause non-deterministic builds.
- `JsonSerializerOptions` should be a singleton — creating a new instance per call is a performance anti-pattern (`JsonSerializer` caches reflection data per options instance).
- Entity Framework migrations: after adding a new `DbSet` or modifying a model, a migration must be generated. Plan this as a separate step.

## Tester

### C# / .NET

- Verify that every `async` void method has been replaced with `async Task` — `async void` swallows exceptions.
- Check that `HttpClient` instances are created via `IHttpClientFactory` — direct `new HttpClient()` leads to socket exhaustion under load.
- Validate that EF Core queries use `.AsNoTracking()` for read-only queries — tracked read-only queries waste memory.

---

## Reviewer

### Verdict signal

After completing all checks, emit the verdict signal as the **last line** of your response:

`[reviewer-verdict] {"agent":"<your-agent-name>","verdict":"<APPROVED|BLOCK|REVISE>","blockers":<N>,"warnings":<N>,"feature":"<feature name>"}`

- `verdict`: `APPROVED` (no issues), `REVISE` (minor issues, gate proceeds), or `BLOCK` (hard blockers, gate disabled)
- `blockers`: integer count of BLOCK-level findings; 0 if APPROVED
- `warnings`: integer count of REVISE-level findings; 0 if APPROVED or BLOCK
- `feature`: taken verbatim from the feature name heading in your review output
- Each reviewer emits its own signal independently; do not aggregate other reviewers' verdicts

---

## Tool-call-auditor

- After completing your audit and emitting any findings, emit the following as the **last line** of your output:
  `[pipeline-summary] mode=<apply-pipeline-mode> verdict=N/A`
- If agent-optimizer is triggered (recurring deviation found), do **not** emit `[pipeline-summary]` — that becomes agent-optimizer's responsibility after it presents its proposed changes.
- Never emit `[pipeline-summary]` more than once per run.
