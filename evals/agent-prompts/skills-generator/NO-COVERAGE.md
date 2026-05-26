# NO-COVERAGE: forge:skills-generator

**Reason:** The skills-generator agent is invoked only during project initialisation via `/forge:init` to generate per-capability skill files for a tech stack. It is not part of ongoing plan/implement/apply pipeline cycles. Exercising it requires a project-init fixture with a target tech stack specification and writable skills directory. Creating a realistic init-phase fixture harness is scoped to a follow-up task. Coverage deferred pending the init-simulation fixture work.
