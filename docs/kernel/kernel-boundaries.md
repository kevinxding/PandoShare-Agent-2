# Kernel Boundaries

## Allowed Direction

- `cli -> core`
- `server -> core`
- `web -> server/api -> core`
- `gateway -> core`
- `core adapter -> legacy services`
- `legacy services -> existing local helpers`

## Forbidden Direction

- `core -> web`
- `core -> cli`
- `core -> server`
- `core -> desktop UI state`
- `gateway -> QueryEngine`
- `loop -> QueryEngine`
- `model -> GUI raw tools`
- `GUI raw tools -> model-facing API`

## Command Boundary

All external entry points should submit a `CommandEnvelope`. They should not manually assemble a private Agent execution flow.

Current state:
- CLI prompt/exec uses `AgentKernel`.
- Web chat uses `AgentKernel`.
- Legacy LoopRuntime uses `AgentKernel`.
- Existing smoke scripts may still instantiate `QueryEngine` directly as focused legacy tests.

## Event Boundary

All durable state changes should create an `EventEnvelope`.

Current state:
- `AgentKernel` creates core run events.
- `GuiRuntime` creates core GUI events.
- `GatewayDaemon` creates core gateway events.
- `LoopRuntime` creates core loop events.
- Legacy `src/services/events` stays in place and can be wrapped through `agentEventToEnvelope`.

## Durable Boundary

Long-running state belongs in append-only or atomic durable stores:
- JSON state: `AtomicFileStore`
- JSONL logs: `JsonlStore`
- events: `DurableRuntime.appendEvent` / `appendEvents`
- checkpoints: `DurableRuntime.createCheckpoint`
- run snapshots: `DurableRuntime.writeRunSnapshot`
- heartbeat: `DurableRuntime.writeHeartbeat`
- recovery decisions: `DurableRuntime.decideRecovery`

## Adapter Rule

Legacy services can remain active only behind adapters.

Adapter markers:
- `AgentKernelAdapter` wraps `QueryEngine`.
- `DingxuGuiAdapter` wraps `src/services/gui`.

New core code should not import Web, CLI, or server modules.

## Agent Run Identity Rule

- `AgentKernel` is the only authority that may generate or accept canonical Agent run identity.
- `CommandEnvelope.runId` must be normalized by `AgentKernel` before execution reaches `RunStateMachine`.
- `QueryEngine` is a legacy executor and must only be directly called by `AgentKernelAdapter` in runtime code.
- `LoopRuntime`, Gateway, Web, and CLI must not generate Agent run state.
- Loop attempts must read `runId` from `AgentKernelRunResult.runId`, not from their original command object.
- Legacy `QueryEngine` run ids may be preserved as `payload.legacyRunId` in bridged events, but they must not replace the canonical top-level `EventEnvelope.runId`.

## Durable Runtime Rule

- New core code must not write event JSONL directly.
- New core code must not write checkpoint JSON/JSONL directly.
- Durable event seq is assigned only by DurableRuntime/EventStore.
- Replay must read through DurableRuntime, not runtime memory.
- RecoveryDecision only classifies recovery state; it must not execute recovery.
- QueryEngine remains the legacy executor, but its events must enter the durable event store through the AgentKernel bridge.
- Shell, GUI, gateway outbound, file write, and MCP write effects must not be replayed automatically.

## Durable Hardening Rule

- Durable JSONL writes for events, checkpoints, snapshots, heartbeats, and run ledger records must use locked append.
- Durable event seq must be assigned inside the EventStore cross-process append transaction.
- New core code should use DurableRuntime for run ledger reads/writes.
- Seq repair is maintenance-only and must not run silently in business paths.
- SideEffectClassifier decides recovery safety boundaries; it does not approve or execute actions.

## Loop Runtime V2 Boundaries

- `LoopRuntime` must not call `QueryEngine` directly.
- `LoopRuntime` must not directly operate tools, GUI backends, gateway adapters, or raw MCP backends.
- Loop truth state comes from `DurableRuntime` events and checkpoints.
- `TaskQueue` is not truth. It may only be used as a transient scheduling helper.
- `LoopStateStore` is a projection cache and must never become a second state source.
- Legacy `LocalLoopStore` is a migration object, not core truth.
- `runNext` may execute at most one task attempt.
- Unsafe external effects must not be automatically replayed by recovery.

## GUI Runtime V2 Boundaries

- GUI Runtime must not call models directly.
- GUI Runtime must not call Loop or Gateway directly.
- Raw Dingxu tools can only be called by adapters, never exposed as model-facing tools.
- GUI write actions require approval or explicit trusted policy.
- GUI recovery must not automatically replay write or dangerous actions.
- GUI action truth comes from DurableRuntime events and checkpoints, not `GuiObservationStore`.
- `GuiObservationStore` is an indexed action/observation record log for replay and diagnostics.

## Gateway Daemon V2 Boundaries

- Gateway must not directly call `QueryEngine`.
- Gateway must not directly execute GUI or Dingxu raw tools.
- Gateway must not directly execute shell/tool operations.
- Gateway outbound must go through a durable outbound queue.
- Gateway inbound must be deduped before routing.
- Gateway approvals must be represented by durable events.
- Gateway recovery must not automatically replay unsafe effects.
- Gateway adapters may send/receive channel messages, but command routing and approval decisions stay in Gateway core.

## Model Router V2 Boundaries

- Model Router must not call GUI raw tools, Gateway adapters, Web UI, CLI, or server code.
- Model Router may read provider config and LLM provider definitions, but transport stays in `src/services/llm`.
- Model Router owns provider/model selection, health state, fallback planning, budget decisions, usage records, and model_* durable events.
- Model Router must not store API keys, access tokens, raw auth headers, or secret-bearing provider payloads.
- Gateway, Loop, GUI, and Agent Kernel may ask Model Router for decisions, but they must not duplicate provider scoring logic.
- Missing auth is a diagnostic state, not a secret value; only env key names may appear in safe summaries.