# NO-COVERAGE: forge:architect

**Reason:** The architect agent is invoked only via `/forge:init` to audit project structure and generate ARCHITECTURE.md and modules.json. It is not invoked in ongoing plan/implement/apply pipeline cycles. Exercising it requires a project-structure fixture with enough source diversity to trigger meaningful architecture discovery output. This init-phase fixture harness is not present at first ship. Coverage deferred to the same follow-up task as forge:skills-generator (both are init-phase agents that share fixture requirements).
