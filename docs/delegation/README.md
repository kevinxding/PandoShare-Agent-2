# Delegation Coordination

This directory records the phase 2-6 productization delegation work.

Baseline before implementation:

- `npm run typecheck`: passed.
- `npm run check`: passed.
- `npm run acceptance:full`: passed, 32/32 steps.

Rules for this phase:

- Do not implement Web UI.
- Do not break existing seven-core public APIs.
- Do not lower smoke assertions.
- Sub-agents own disjoint implementation directories.
- `package.json`, `src/core/index.ts`, and generated acceptance files are integrated by the controller.
- Sub-agent pass/fail claims must be backed by smoke scripts and controller verification.

Sub-agent reports:

- `subagent-a-backend-report.md`
- `subagent-b-toolruntime-report.md`
- `subagent-c-benchmark-report.md`
- `subagent-d-context-report.md`
- `subagent-e-sandbox-report.md`
