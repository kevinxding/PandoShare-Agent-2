# Kernel Acceptance Report

Status: verified for the Agent Kernel identity pass.

## Completed Items

- Added canonical run identity types: `RunIdentity` and `RunContext`.
- Added `AgentKernel.submitRun(command)` as the strong Agent run entry.
- Kept `AgentKernel.run(prompt)` and `submitMessage(prompt)` compatible by returning `QueryTurnOutput`.
- Changed `AgentKernel.submit(command)` to delegate to `submitRun(command)`.
- Moved canonical `runId` generation into `AgentKernel.normalizeCommand`.
- Changed `RunStateMachine.startRun` to require normalized `command.runId`.
- Added `run_created`, `run_running`, and `run_interrupted` event semantics.
- Fixed `running` so it no longer emits a second `run_start`.
- Fixed `interrupted` so it emits `run_interrupted`, never `run_failed`.
- Added command metadata to `RunState`: `commandId`, `commandType`, and `source`.
- Added `RunLedger` JSONL snapshots with `readRun`, `readActiveRuns`, and `readRecentRuns`.
- Added `AgentKernelEventBridge` for legacy `AgentEvent` to core `EventEnvelope` conversion.
- Preserved legacy event run ids as `payload.legacyRunId` while using the canonical top-level `runId`.
- Added completed, failed, and interrupted checkpoint handling in `AgentKernel`.
- Marked interrupted checkpoints as `unsafe_to_replay`.
- Changed `AttemptRunner` to call `agentKernel.submitRun(command)` and read `result.runId`.
- Kept CLI prompt/exec, Web chat, and legacy LoopRuntime behavior on `engine.run(prompt)` / `submitMessage(prompt)`.

## RunId Chain

Canonical run identity now flows through this chain:

`AgentKernel.normalizeCommand -> CommandEnvelope.runId -> RunStateMachine -> EventEnvelope.runId -> RunLedger -> DurableRuntime checkpoint -> AgentKernelRunResult.runId -> Attempt.runId`

`QueryEngine` still creates its own legacy run id internally. That value is treated as legacy executor detail and is preserved only in bridged event payloads as `legacyRunId`.

## EventBridge Coverage

The bridge currently converts all recorded legacy `AgentEvent` records exposed by `AgentKernelAdapter.events()`.

Covered categories include:

- Legacy run lifecycle events.
- Context build events.
- Model request and response events.
- Tool call and tool result events.
- Approval events.
- Compaction events.
- GUI action events when produced by legacy tools.

The bridge deduplicates by legacy event id. It does not yet normalize every legacy payload into narrower core-specific payload schemas; that is intentionally left to the next tool-event bridge pass.

## Incomplete Items

- `QueryEngine` still owns context building, compaction, tool execution, thread messages, and its own legacy run ledger.
- `AgentKernelAdapter` still wraps a single lazy `QueryEngine` instance; first-class resume should move into QueryEngine or a core thread session API later.
- Tool events are bridged generically, not yet mapped into complete typed core tool event payloads.
- Durable run index is JSONL snapshot based; it is not yet a full query/index service.
- Replay CLI is not implemented in this pass.

## Test Results

All commands below were run locally from the repository root.

| Command | Result |
|---|---|
| `npm run typecheck` | passed |
| `npm run check` | passed |
| `npm run kernel:smoke` | passed |
| `npm run events:smoke` | passed |
| `npm run thread-store:smoke` | passed |
| `npm run loop-runtime:smoke` | passed |
| `npm run gateway:smoke` | passed |
| `npm run gui-tool:smoke` | passed |
| `npm run model-smoke` | passed |

Additional kernel smoke assertions now cover:

- `AgentKernel.submitRun` returns `runId`, `finalText`, `output`, `coreEvents`, and `checkpointId`.
- `RunStateMachine` emits `run_running` without duplicating `run_start`.
- Interrupt emits `run_interrupted`, not `run_failed`.
- `AttemptRunner` returns a non-empty `Attempt.runId`.
- `AgentKernelEventBridge` writes at least one legacy event with canonical `runId`.
- `RunLedger` can read a completed run.
- Failed runs write safe failed checkpoints with error previews.
- Interrupted runs write unsafe checkpoints.

## Known Risks

- External `AgentKernel.abort(reason)` still delegates to the legacy adapter; command-driven `agent.interrupt` / `agent.stop` has the stronger state transition semantics.
- Core events now include both core lifecycle events and bridged legacy lifecycle events. Replay consumers should distinguish by `eventId`/payload source until typed tool-event normalization is added.
- Legacy smoke scripts still instantiate `QueryEngine` directly to preserve focused legacy behavior coverage.
