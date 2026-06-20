# Kernel Migration Plan

## Existing Module Mapping

| Current module | Target kernel | Migration path |
|---|---|---|
| `src/QueryEngine.ts` | Agent Kernel | Keep as legacy executor. It should only be directly constructed by `src/core/agent/AgentKernelAdapter.ts` in runtime code. |
| `src/services/threadStore` | Durable Runtime | Keep existing thread format. Migrate its JSON/JSONL helpers onto core store primitives. |
| `src/services/events` | Protocol / Event Replay | Keep `AgentEvent`. Bridge through `AgentKernelEventBridge` into canonical `EventEnvelope` records. |
| `src/services/permissions` | Protocol / Agent Kernel | Keep terminal/web approvals. Represent new human gates as approval commands/events. |
| `src/services/contextBuilder` | Agent Kernel | Keep inside QueryEngine for now. Continue surfacing context events through the legacy bridge. |
| `src/services/compact` | Durable Runtime / Agent Kernel | Keep current compaction implementation. Treat compaction summaries as checkpoint-like durable state. |
| `src/services/llm` | Model Router | Keep provider definitions and route selection in `ModelRouter`; do not change provider choice inside Agent Kernel. |
| `src/services/loopRuntime` | Loop Runtime | Keep full legacy loop implementation. Core loop attempts must enter Agent work through `AgentKernel.submitRun`. |
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

Implemented in this pass:

- `AgentKernel.submitRun(command)` as the strong Agent entry.
- Canonical run id normalization in AgentKernel.
- Run identity propagation through command, state machine, events, checkpoint, ledger, result, and Loop attempt.
- Agent command handling for `agent.run`, `agent.resume`, `agent.interrupt`, `agent.stop`, and `agent.status`.
- Core run ledger snapshots.
- Legacy event bridge into core event stream.
- Completed, failed, and interrupted checkpoint semantics.

## Phase 3: Durable Runtime Deepening

Next work:

- Promote `RunLedger` into a broader durable run index service if cross-process status queries become necessary.
- Add atomic compaction/checkpoint index helpers for efficient lookup.
- Add stale active-run recovery rules for long-lived daemon and gateway operation.
- Link heartbeat, run ledger, and checkpoint records in one durable diagnostic view.

## Phase 4: ThreadStore Core Primitives

Next work:

- Replace duplicated legacy JSON helpers with `AtomicFileStore`.
- Move ThreadStore metadata writes to core atomic write helpers.
- Append canonical `EventEnvelope` records beside legacy thread `AgentEvent` records.
- Add replay views for thread messages, checkpoints, compactions, and run ledger records.

## Phase 5: Tool Events Complete Bridge

Next work:

- Split generic bridged `tool_call` events into typed `tool_call_started`, `tool_call_completed`, `tool_result`, and approval payload contracts.
- Preserve tool input redaction guarantees before writing core events.
- Link large tool results to durable storage artifacts instead of embedding oversized payloads.
- Add smoke tests for model -> tool -> approval -> result replay timelines.

## Phase 6: Replay CLI

Next work:

- Add `pando replay run <runId>` for a readable timeline.
- Add `pando replay thread <threadId>` for thread-level event history.
- Add JSON output for external diagnostics.
- Use canonical run ids and bridged legacy event ids for exact provenance.

## Risk Notes

- `QueryEngine` remains the legacy executor for context, compact, tools, and thread writes.
- `AgentKernelAdapter` is intentionally thin and should not grow state ownership.
- Resume is still adapter-level thread initialization, not a dedicated core resume engine.
