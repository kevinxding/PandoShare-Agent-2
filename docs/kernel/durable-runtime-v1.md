# Durable Runtime V1

## Boundary

Durable Runtime V1 is the core runtime persistence judge. It does not execute business logic, choose models, call tools, operate GUI surfaces, or send gateway messages.

It owns these durable contracts:

- Event submission order.
- Checkpoint safety semantics.
- Run snapshots for recovery pointers.
- Heartbeats and stale-worker checks.
- Recovery decisions and consistency audit.

## Not Full Event Sourcing

This pass is not a full event sourcing replacement. Legacy `QueryEngine`, `ThreadStore`, tool orchestration, LoopRuntime, GatewayRuntime, and GUI services still keep their own working state.

Durable Runtime V1 adds a system-level truth layer beside those legacy paths. It records enough durable evidence to avoid lying after a crash, but it does not reconstruct every legacy object from events yet.

## EventStore Seq Rules

- Events are append-only.
- DurableRuntime is the only public entry for core event writes.
- Workspace event seq is assigned by `EventStore` through a durable counter.
- Callers must submit event drafts without `seq`.
- Pre-sequenced events are rejected by default.
- Import mode exists for focused tests and future migration tools only.
- `readRunEvents(runId)` returns events ordered by durable seq.
- Payloads pass through basic secret redaction before persistence.

## Checkpoint Safety

Checkpoint statuses:

- `safe_to_replay`: the run reached a confirmed safe replay boundary.
- `partial_replay`: the run has a useful boundary, but replay must account for uncertainty.
- `unsafe_to_replay`: the run must not be replayed automatically.

Rules:

- Completed Agent runs use `safe_to_replay`.
- Failed Agent runs default to `partial_replay`.
- Interrupted Agent runs use `unsafe_to_replay`.
- Checkpoints record `lastEventSeq`.
- Pending external effects are recorded as explicit `pendingExternalEffects`.
- Large tool outputs should be summarized or referenced with `snapshotRef`, not embedded.

## RunSnapshot vs RunLedger

`RunLedger` records Agent run state snapshots for history and status.

`RunSnapshot` records the recovery pointer:

- latest known event boundary,
- active phase,
- active tool/model/approval identifiers when available,
- retry count.

Audit compares both. If the latest ledger status and latest recovery snapshot status diverge, the run is treated as drifted/corrupted until reviewed.

## RecoveryDecision Matrix

| State | Decision |
|---|---|
| completed run | `already_completed` |
| failed run without safe recovery boundary | `mark_failed` |
| failed run with `partial_replay` and no pending external effects | `recoverable_auto` |
| interrupted run | `requires_human` |
| active non-stale heartbeat | `requires_human` |
| pending external effects | `requires_human` |
| seq/checkpoint/snapshot/ledger corruption | `mark_corrupted` |
| pure starting/model/checkpoint phase without unsafe effects | `recoverable_auto` |

## Effects Never Auto-Replayed

Durable Runtime V1 does not automatically replay:

- shell commands,
- GUI actions,
- gateway outbound sends,
- file writes,
- MCP write tools,
- any unconfirmed external side effect.

These become `requires_human` when present in a checkpoint or recovery context.

## Legacy State Remaining

- `QueryEngine` still owns context building, compaction, tool execution, thread messages, and legacy run ledger writes.
- `ThreadStore` still stores legacy messages/events/checkpoints.
- Tool events are bridged generically, not fully normalized into typed core tool payloads.
- LoopRuntime and GatewayRuntime still have domain-specific stores.
- Replay is read-only and does not resume or execute anything.

## Durable Runtime V2 Suggestions

- Move `RunLedger` fully behind DurableRuntime.
- Add typed tool-event bridge payloads.
- Add durable artifact refs for large tool outputs.
- Add replay CLI commands for run and thread timelines.
- Add stale active-run cleanup and operator review workflows.
- Add ThreadStore migration onto core store primitives.

## V1.1 Hardening Addendum

V1.1 hardens local multi-process execution by adding ProcessFileLock, locked JSONL append, durable seq transaction boundaries, DurableRuntime-owned RunLedgerStore, SideEffectClassifier, checkpoint downgrade from unsafe effects, and maintenance reports.

Seq repair remains explicit maintenance-only behavior. RecoveryDecision still only decides; it does not resume execution.
