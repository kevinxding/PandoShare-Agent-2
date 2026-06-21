# Loop Engineering V3 Baseline

## Scope

Loop Engineering V3 is an additive baseline beside Loop Runtime V2. It does not replace `src/core/loop`, does not execute tools directly, and does not add Web UI. The baseline focuses on durable loop engineering metadata: spec validation, safe automation tick decisions, verifier graph results, subagent permission bindings, skill-candidate memory records, connector risk plans, and replay-readable journal events.

## Required Spec

`LoopSpecV3` includes:

- `loopId`, `goalId`, `objective`, and `successCriteria[]`.
- `verificationPlan` with command, file, replay, model_mock, or custom verifier nodes and optional dependencies.
- `automationTrigger`: `manual`, `interval`, `heartbeat`, `gateway`, or `file_change`.
- `workspaceIsolation`: `none`, `temp_copy`, or `git_worktree`.
- `subagents[]` with role, family, and optional permission override.
- `skillPolicy`, `connectorPolicy`, `statePolicy`, `budgetPolicy`, and `humanGatePolicy`.

`validateLoopSpecV3` and `assertValidLoopSpecV3` reject missing fields, invalid enum values, duplicate verifier node ids, missing verifier dependencies, duplicate subagents, invalid policy objects, and budget violations such as too many subagents.

## Automation Scheduler

`AutomationScheduler` supports only `manual`, `interval`, and `heartbeat` triggers in this baseline. `gateway` and `file_change` are accepted by the spec but produce an explicit `unsupported_automation_trigger` tick result. This is intentional until the gateway daemon and file watcher integration are wired by a controller-owned layer.

Each tick:

- Selects at most one safe task.
- Treats only `none` and `read` side effects as safe.
- Reports skipped unsafe task ids.
- Supports pause and resume per loop.
- Writes `loop_engineering_automation_tick` through `LoopStateJournal` when a journal is provided.

The scheduler never runs shell, GUI, gateway, file write, or external side effects.

## Verifier Graph

`VerifierGraph` supports these node types:

- `command`: requires an injected `commandRunner`; the core does not run arbitrary shell commands by itself.
- `file`: checks existence and optional content under a workspace root.
- `replay`: checks supplied replay results.
- `model_mock`: checks deterministic mock output.
- `custom`: uses a supplied handler or explicit `expectedOk`.

Dependencies are evaluated in graph order. A node with a failed dependency is skipped with `dependency_failed`. Verifier identity is checked against builder families; a verifier from the same family as a builder fails unless same-family verification is explicitly allowed.

The graph returns `VerificationGraphResult` with `ok`, timing, per-node results, and clear `failureReasons`.

## Subagents

`SubAgentRegistry` defines these profiles:

- `builder` -> `loop_worker`
- `planner` -> `plan`
- `verifier` -> `verifier`
- `reviewer` -> `readonly`
- `gui-operator` -> `gui_write_approval`
- `gateway-operator` -> `gateway_operator`

Verifier subagents cannot share a family with builder subagents unless `allowVerifierSameFamily` is set. Assignments bind to the existing `permissions-v2` profile objects.

## Skill Candidates

`SkillCandidateWriter` writes append-only `MemoryStore` records with `scope=skill`. A candidate must include trigger, procedure, verification, pitfalls, and refs. The writer adds a stable `skill:<skillId>` tag, relies on MemoryStore redaction, and refuses duplicate skill ids instead of overwriting existing skill candidates.

## Connector Plan

`ConnectorPlan` is plan-and-risk only. It expresses MCP, Gateway, File, and GUI connector requirements, marks execution as `false`, and flags write or delivery access for human gate review. It does not open connectors or perform side effects.

## Journal

`LoopStateJournal` records these replay-readable events through `DurableRuntime.appendEvent` when a durable runtime is supplied, or append-only JSONL otherwise:

- `loop_engineering_spec_recorded`
- `loop_engineering_automation_tick`
- `loop_engineering_verifier_graph`
- `loop_engineering_subagent_assignment`
- `loop_engineering_skill_candidate`

## Validation

Run after build:

```bash
npm run build -- --pretty false
node scripts/loop-engineering-v3-smoke.mjs
node scripts/loop-verifier-graph-smoke.mjs
node scripts/loop-skill-candidate-smoke.mjs
```

## Known Partials

- `gateway` and `file_change` automation triggers are spec-level only and return explicit unsupported tick results.
- Command verifier nodes require an injected command runner; the core baseline does not execute arbitrary shell commands directly.
- Connector plans are risk plans only and never execute connector operations.
- Workspace isolation is represented in `LoopSpecV3`; actual lease orchestration remains in the existing workspace layer and is not invoked by this baseline.