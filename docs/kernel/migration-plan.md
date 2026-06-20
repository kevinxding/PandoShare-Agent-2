# Kernel Migration Plan

## Existing Module Mapping

| Current module | Target kernel | Migration path |
|---|---|---|
| `src/QueryEngine.ts` | Agent Kernel | Keep as legacy executor. It should only be directly constructed by `src/core/agent/AgentKernelAdapter.ts` in runtime code. |
| `src/services/threadStore` | Durable Runtime | Keep existing thread format. Migrate metadata/messages/events/checkpoints onto core store primitives over time. |
| `src/services/events` | Protocol / Event Replay | Keep `AgentEvent`. Bridge through `AgentKernelEventBridge` into canonical durable events. |
| `src/services/permissions` | Protocol / Agent Kernel | Keep terminal/web approvals. Represent future human gates as approval commands/events. |
| `src/services/contextBuilder` | Agent Kernel | Keep inside QueryEngine for now. Continue surfacing context events through the bridge. |
| `src/services/compact` | Durable Runtime / Agent Kernel | Keep current compaction implementation. Connect compact summaries to checkpoint/replay views later. |
| `src/services/llm` | Model Router | Keep provider definitions and route selection in `ModelRouter`; do not change provider choice inside Durable Runtime. |
| `src/services/loopRuntime` | Loop Runtime | Keep full legacy loop implementation. Core loop attempts enter Agent work through `AgentKernel.submitRun`. |
| `src/services/gatewayRuntime` | Gateway Daemon | Keep current gateway runtime. Gateway may submit commands to core, but must not own Agent run state. |
| `src/services/gui` | GUI Runtime | Keep Dingxu/Windows MCP integration. GUI tools remain behind stable Pando GUI surfaces. |
| `src/server` | Entry point | Server may depend on core. It should not be a state source or generate Agent run state. |
| `src/main.tsx` | Entry point | CLI may depend on core. Prompt and exec continue through `AgentKernel.run`. |
| `web/src/App.tsx` | UI only | Web UI stays a client of server APIs. It must not own durable runtime state. |

## Phase 1: Core Boundary

Implemented:

- Core protocol, store, durable, agent, loop, GUI, gateway, model, and replay skeletons.
- CLI prompt/exec, Web chat, and legacy LoopRuntime route through `AgentKernel`.
- Kernel smoke covers the seven-kernel foundation.

## Phase 2: Agent Kernel Identity

Implemented:

- `AgentKernel.submitRun(command)` as the strong Agent entry.
- Canonical run id normalization in AgentKernel.
- Run identity propagation through command, state machine, events, checkpoint, ledger, result, and Loop attempt.
- Agent command handling for `agent.run`, `agent.resume`, `agent.interrupt`, `agent.stop`, and `agent.status`.
- Core run ledger snapshots.
- Legacy event bridge into core event stream.
- Completed, failed, and interrupted checkpoint semantics.

## Phase 3: Durable Runtime V1

Implemented in this pass:

- DurableRuntime facade for events, checkpoints, run snapshots, heartbeat, recovery decisions, and audit.
- EventStore durable seq allocation and redaction.
- Checkpoint safety contracts.
- RunSnapshot recovery pointers.
- Heartbeat stale checks.
- RecoveryDecision without automatic resume execution.
- ConsistencyAudit and corruption marker events.
- Replay reads through DurableRuntime.

## Phase 4: Durable Runtime V1.1

Implemented in this pass:

- Cross-process ProcessFileLock.
- Locked durable JSONL append.
- Event seq and append hardening.
- RunLedgerStore ownership moved into DurableRuntime.
- SideEffectClassifier and unsafe checkpoint downgrade.
- Maintenance report and durable hardening smoke.

## Phase 5: Durable Runtime V2

Next work:

- Move `RunLedger` fully behind DurableRuntime instead of reading the agent-owned queue file.
- Add cross-process durable seq locking.
- Add typed tool-event bridge payloads.
- Add explicit side-effect classifier for shell, GUI, gateway outbound, file write, and MCP write events.
- Add durable artifact refs for large tool results.
- Add operator review records for `requires_human` recovery decisions.

## Phase 6: ThreadStore Core Primitives

Next work:

- Replace duplicated legacy JSON helpers with `AtomicFileStore`.
- Move ThreadStore metadata writes to core atomic write helpers.
- Append canonical `EventEnvelope` records beside legacy thread `AgentEvent` records.
- Add replay views for thread messages, checkpoints, compactions, and run ledger records.

## Phase 7: Replay CLI

Next work:

- Add `pando replay run <runId>` for a readable timeline.
- Add `pando replay thread <threadId>` for thread-level event history.
- Add JSON output for external diagnostics.
- Include recovery decision, checkpoint list, and audit output.

## Risk Notes

- `QueryEngine` remains the legacy executor for context, compact, tools, and thread writes.
- `AgentKernelAdapter` is intentionally thin and should not grow state ownership.
- Resume is still adapter-level thread initialization, not a dedicated core resume engine.
- Durable Runtime V1 is not full event sourcing; it is a recovery contract layer.
