# Durable Runtime V1.1 Hardening

## What V1.1 Fixes

Durable Runtime V1 established the persistence facade. V1.1 hardens the pieces needed before multi-process 7x24 operation:

- Cross-process file locking for durable writes.
- Workspace event seq consistency under concurrent processes.
- Locked JSONL append for events, checkpoints, snapshots, heartbeats, and run ledger records.
- RunLedger ownership moved behind DurableRuntime.
- Side-effect classification for recovery safety.
- Maintenance reporting for health dashboards.

## ProcessFileLock

`ProcessFileLock` uses atomic creation of a lock path `${target}.lock`. The lock path stores an `owner.json` record with:

- `pid`
- `createdAtMs`
- `hostname`
- `reason`
- `lockToken`

Acquire options:

- `timeoutMs`
- `staleMs`
- `retryDelayMs`
- `reason`

Release only removes the lock when the current `owner.json` contains the same `lockToken`. Stale lock takeover writes a `.stale-<timestamp>` evidence file before removing the stale lock.

Limitations:

- This is a filesystem lock, not a distributed lock.
- Correctness depends on all writers using DurableRuntime and the same workspace path.
- It is suitable for local multi-process Pando operation, not multi-host shared storage without further hardening.

## Seq And Append Transaction Boundary

Durable event append uses one cross-process lock around:

1. Read seq state.
2. Allocate next seq.
3. Write seq state.
4. Append one JSONL event line.
5. Release lock.

Business callers submit event drafts without `seq`. DurableRuntime/EventStore assigns seq. Pre-sequenced events are rejected unless explicit import mode is used by tests or migration tooling.

V1.1 does not automatically repair seq state. If seq state is corrupt, append fails. Operators or tests must call `repairSeqFromEventsForMaintenance()`, which rebuilds seq from the max event seq.

## RunLedger Ownership

`RunLedgerStore` now lives in `src/core/durable`. The old `src/core/agent/RunLedger.ts` is a compatibility re-export.

New core code should use:

- `DurableRuntime.appendRunLedger`
- `DurableRuntime.readRun`
- `DurableRuntime.readActiveRuns`
- `DurableRuntime.readRecentRuns`

AgentKernel writes run ledger through DurableRuntime.

## SideEffectClassifier

Effect types:

| effectType | Auto recoverable |
|---|---|
| `readonly_tool` | yes |
| `file_read` | yes |
| `file_write` | no |
| `shell_readonly` | yes |
| `shell_write` | no |
| `gui_read` | yes |
| `gui_write` | no |
| `gateway_inbound` | yes |
| `gateway_outbound` | no |
| `model_request` | yes, but provider request is not replayed directly |
| `mcp_read` | yes |
| `mcp_write` | no |
| `unknown_external` | no |

Unsafe effects become pending external effects when passed to checkpoint creation as `effectHints`.

## Effects Never Auto-Replayed

Durable Runtime must not automatically replay:

- file writes,
- shell writes,
- GUI writes,
- gateway outbound sends,
- MCP writes,
- unknown external effects.

RecoveryDecision returns `requires_human` when such effects are pending.

## Maintenance Report

`DurableRuntime.createMaintenanceReport()` returns:

- latest seq,
- event count,
- corrupt record count,
- active runs,
- stale heartbeats,
- recent corruption events.

This is intended for a future health dashboard and operator workflows.

## Still Not A Resume Runner

V1.1 only decides recovery safety. It does not resume runs, replay tools, resend gateway messages, click GUI, or reissue shell commands.

Loop Runtime V2 can build on this contract later.
