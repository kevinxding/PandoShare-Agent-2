# Integration Plan

## Sequence

1. Establish baseline with typecheck, architecture check, and generated acceptance.
2. Run five sub-agents on disjoint source/doc/script areas.
3. Review sub-agent reports and changed files.
4. Integrate shared exports and package scripts in one controller pass.
5. Run focused smoke scripts per sub-agent.
6. Run `productization:phase-smoke`.
7. Run full verification and regenerate acceptance evidence.

## Ownership

| Sub-agent | Primary source ownership | Script ownership | Docs ownership |
| --- | --- | --- | --- |
| A | `src/core/backend/` | `scripts/backend-*.mjs` | `docs/productization/backend-service-facade.md` |
| B | `src/core/tool/`, `src/core/code-agent/`, `tests/fixtures/code-agent/` | `scripts/tool-runtime-smoke.mjs`, `scripts/code-agent-*.mjs`, `scripts/patch-verifier-smoke.mjs` | `docs/productization/tool-runtime-v2.md`, `docs/productization/code-agent-harness.md` |
| C | `src/core/benchmark/`, `benchmarks/` | `scripts/benchmark-*.mjs` | `docs/productization/benchmark-harness.md`, `docs/productization/world-class-eval-plan.md` |
| D | `src/core/context/`, `src/core/memory/`, `src/core/compaction/` | `scripts/context-*.mjs`, `scripts/memory-store-smoke.mjs`, `scripts/compaction-runtime-smoke.mjs` | `docs/productization/context-memory-compaction-v2.md` |
| E | `src/core/workspace/`, `src/core/sandbox/`, `src/core/permissions-v2/` | `scripts/worktree-smoke.mjs`, `scripts/*policy-smoke.mjs`, `scripts/permission-profile-smoke.mjs` | `docs/productization/worktree-sandbox-permission-hardening.md` |

## Controller-only Files

- `package.json`
- `src/core/index.ts`
- `docs/kernel/acceptance-report.md`
- `docs/kernel/generated-acceptance-report.md`
- `docs/kernel/generated-acceptance-report.json`
- `docs/kernel/reality-matrix.md`
- `docs/kernel/productization-roadmap.md`
- `docs/productization/phase-2-to-6-summary.md`
