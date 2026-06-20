# Kernel Acceptance Report

Status: verified for Durable Runtime V1.1 hardening.

## Durable Runtime V1.1 Completed Items

- Added `ProcessFileLock` for cross-process local filesystem locking.
- Added locked JSONL append APIs to `JsonlStore`.
- Changed EventStore append so durable seq assignment and event append run under one cross-process lock.
- EventSeq no longer resets corrupt state to zero; corrupt seq state fails append.
- Added explicit maintenance repair through `repairSeqFromEventsForMaintenance()`.
- Moved RunLedger implementation into `src/core/durable/RunLedgerStore.ts`.
- Kept `src/core/agent/RunLedger.ts` as compatibility re-export.
- Routed AgentKernel run ledger writes through DurableRuntime.
- Added SideEffectClassifier and side-effect types.
- Checkpoint creation accepts `effectHints` and downgrades unsafe effects away from `safe_to_replay`.
- RecoveryPlanner returns `requires_human` when pending external effects exist.
- Maintenance report exposes latest seq, event count, corrupt record count, active runs, stale heartbeats, and recent corruption events.
- Added `scripts/durable-hardening-smoke.mjs` and `npm run durable:hardening-smoke`.
- Added `docs/kernel/durable-runtime-v1-1-hardening.md`.

## Recovery Safety Coverage

Covered by smoke tests:

- Cross-process concurrent append gives seq `1..200` with no duplicates and no gaps.
- Corrupt seq state fails append and does not reset to zero.
- Explicit maintenance repair restores seq from existing events.
- Corrupt JSONL lines are reported without deleting evidence.
- RunLedger reads/writes go through DurableRuntime.
- Shell write, GUI write, gateway outbound, and readonly tool classification works.
- Unsafe effects downgrade checkpoints and force `requires_human` recovery.
- Maintenance report includes corrupt records and stale heartbeats.

## Test Results

All commands below were run locally from the repository root.

| Command | Result |
|---|---|
| `npm run typecheck` | passed |
| `npm run check` | passed |
| `npm run kernel:smoke` | passed |
| `npm run durable:smoke` | passed |
| `npm run durable:hardening-smoke` | passed |
| `npm run events:smoke` | passed |
| `npm run thread-store:smoke` | passed |
| `npm run loop-runtime:smoke` | passed |
| `npm run gateway:smoke` | passed |
| `npm run gui-tool:smoke` | passed |
| `npm run model-smoke` | passed |
Full regression is run before final handoff and recorded in the final response.

## Incomplete Items

- No real resume runner exists yet.
- Event seq repair is manual maintenance only.
- ProcessFileLock is local filesystem coordination, not distributed locking.
- Side-effect classification is heuristic and should become richer when typed tool events are completed.
- Legacy ThreadStore remains in place.

## Risks

- If a non-core writer bypasses DurableRuntime, seq and audit guarantees do not apply.
- Cross-process locking relies on all workers sharing the same workspace filesystem semantics.
- The shell classifier is intentionally conservative and may require human review for commands that are technically safe.

## Next Step Suggestions

- Build Loop Runtime V2 on top of DurableRuntime recovery decisions.
- Add typed tool-event bridge payloads.
- Add health dashboard views from `createMaintenanceReport()`.
- Add operator workflows for `requires_human` and `mark_corrupted` decisions.

## Loop Runtime V2 Acceptance Update

Implemented in this pass:

- Added Loop Event Contract V2 constants and exports.
- Added centralized Loop identity helpers.
- Added pure `LoopProjector` and projection cache `LoopStateStore`.
- Added `LoopScheduler`, `LoopCommandHandler`, `LoopRecovery`, and `LoopLegacyAdapter`.
- Refactored core `LoopRuntime` to provide `createLoop`, `runNext`, `resumeLoop`, `status`, and `recoverLoop`.
- Kept `runGoal` as a compatibility API through `createLoop + runNext`.
- Eventized `HumanGate`, `LoopVerifier`, and `AttemptRunner`.
- Added loop projection support to replay reports.
- Added `loop:core-smoke`, `loop:projection-smoke`, and `loop:recovery-smoke` scripts.

Verification run during implementation:

- `npm run typecheck` passed.
- `npm run loop:core-smoke` passed.
- `npm run loop:projection-smoke` passed.
- `npm run loop:recovery-smoke` passed.
- `npm run kernel:smoke` passed.
- `npm run durable:smoke` passed.
- `npm run loop-runtime:smoke` passed.

Remaining verification before release: run the full requested gate set including `npm run check`, `durable:hardening-smoke`, `gateway:smoke`, `gui-tool:smoke`, and `model-smoke`.

Final verification for this Loop Runtime V2 pass:

- `npm run typecheck` passed.
- `npm run check` passed.
- `npm run kernel:smoke` passed.
- `npm run durable:smoke` passed.
- `npm run durable:hardening-smoke` passed.
- `npm run loop:core-smoke` passed.
- `npm run loop:projection-smoke` passed.
- `npm run loop:recovery-smoke` passed.
- `npm run loop-runtime:smoke` passed.
- `npm run gateway:smoke` passed.
- `npm run gui-tool:smoke` passed.
- `npm run model-smoke` passed.

Completion-audit follow-up:

- `LoopCommandHandler` now handles `loop.pause`, `loop.stop`, `loop.approve`, and `loop.reject` through durable loop events instead of returning placeholder failures.
- `LoopLegacyAdapter` now bridges legacy export-shaped data and returns a migration projection summary.
- `ReplayReader` now exposes `readWithLoopProjection` and `buildLoopReplayMarkdown` to reduce caller risk of omitting loop projection summaries.
- `core-loop-smoke` now covers command handling and replay markdown projection.
- `loop-recovery-smoke` now covers legacy export bridging.

Second verification after the completion-audit fixes:

- `npm run typecheck` passed.
- `npm run check` passed.
- `npm run kernel:smoke` passed.
- `npm run durable:smoke` passed.
- `npm run durable:hardening-smoke` passed.
- `npm run loop:core-smoke` passed.
- `npm run loop:projection-smoke` passed.
- `npm run loop:recovery-smoke` passed.
- `npm run loop-runtime:smoke` passed.
- `npm run gateway:smoke` passed.
- `npm run gui-tool:smoke` passed.
- `npm run model-smoke` passed.

## GUI Runtime V2 Acceptance Update

Implemented in this pass:

- Added GUI V2 event constants, identity helpers, and action state definitions.
- Expanded GUI runtime types for stable action, observation, verification, approval, lease, side effect, and record contracts.
- Added GUI policy classification, approval bridge, durable lease manager, and stuck detector.
- Refactored `GuiRuntime` around `observe`, `requestAction`, `executeApprovedAction`, `act`, `verify`, `recoverGuiAction`, `readAction`, and `listRecentActions`.
- Updated Dingxu and mock adapter verification semantics.
- Split GUI observation/action records and added replay-friendly refs.
- Added GUI timeline output to replay reports.
- Added optional `GuiTool` core runtime bridge while keeping legacy GUI behavior.
- Added `gui:runtime-smoke`, `gui:approval-smoke`, and `gui:recovery-smoke`.

Initial verification:

- `npm run typecheck` passed.
- `npm run kernel:smoke` passed.
- `npm run gui-tool:smoke` passed.
- `npm run gui:runtime-smoke` passed.
- `npm run gui:approval-smoke` passed.
- `npm run gui:recovery-smoke` passed.

Final GUI Runtime V2 verification:

- `npm run typecheck` passed.
- `npm run check` passed.
- `npm run kernel:smoke` passed.
- `npm run durable:smoke` passed.
- `npm run durable:hardening-smoke` passed.
- `npm run loop:core-smoke` passed.
- `npm run loop:projection-smoke` passed.
- `npm run loop:recovery-smoke` passed.
- `npm run loop-runtime:smoke` passed.
- `npm run gui-tool:smoke` passed.
- `npm run gui:runtime-smoke` passed.
- `npm run gui:approval-smoke` passed.
- `npm run gui:recovery-smoke` passed.
- `npm run gateway:smoke` passed.
- `npm run model-smoke` passed.

## Gateway Daemon V2 Acceptance Update

Implemented in this pass:

- Added Gateway V2 event contract, identity, envelope, operational store, channel adapter, dispatcher, approval bridge, wake scheduler, retry policy, legacy adapter, and daemon control loop.
- `GatewayDaemon` now exposes `start`, `stop`, `status`, `tick`, `recover`, `receiveInbound`, `dispatchNextInbound`, `sendNextOutbound`, `health`, `listPendingApprovals`, and `enqueueOutbound`.
- Inbound queue dedupes duplicate external messages before dispatch.
- Outbound queue persists delivery state and supports retry/backoff with stable `deliveryId`.
- CommandRouter V2 covers `/goal`, `/resume`, `/approve`, `/deny`, `/gui`, `/model`, `/usage`, `/help`, and related gateway commands.
- Dispatcher calls only core public APIs or injected Gateway callbacks; it does not call QueryEngine or raw GUI adapters.
- ApprovalBridge lists and resolves agent, loop, GUI, recovery, delivery, and model-switch approval types.
- WakeScheduler can trigger at most one background loop task per tick.
- Recovery escalation queues human handling for unsafe/requires-human decisions without replaying external effects.
- Replay reports include a Gateway Timeline section.
- Legacy gatewayRuntime remains intact and is bridged through GatewayLegacyAdapter.

Verification run during implementation:

- `npm run typecheck` passed.
- `npm run gateway:core-smoke` passed.
- `npm run gateway:command-smoke` passed.
- `npm run gateway:delivery-smoke` passed.
- `npm run gateway:approval-smoke` passed.
- `npm run gateway:recovery-smoke` passed.

Known unfinished items:

- Real long-running process manager is not implemented.
- System service install is not implemented.
- Complex cron DSL is not implemented.
- Full real Telegram/Feishu/Lark/WeCom webhook integration is not implemented.
- Multi-workspace gateway supervisor is not implemented.
- Web approval UI is not implemented.
- Legacy gatewayRuntime is preserved, not removed or fully replaced.

Final Gateway Daemon V2 verification:

- `npm run typecheck` passed.
- `npm run check` passed.
- `npm run kernel:smoke` passed.
- `npm run durable:smoke` passed.
- `npm run durable:hardening-smoke` passed.
- `npm run loop:core-smoke` passed.
- `npm run loop:projection-smoke` passed.
- `npm run loop:recovery-smoke` passed.
- `npm run loop-runtime:smoke` passed.
- `npm run gui-tool:smoke` passed.
- `npm run gui:runtime-smoke` passed.
- `npm run gui:approval-smoke` passed.
- `npm run gui:recovery-smoke` passed.
- `npm run gateway:smoke` passed.
- `npm run gateway:core-smoke` passed.
- `npm run gateway:command-smoke` passed.
- `npm run gateway:delivery-smoke` passed.
- `npm run gateway:approval-smoke` passed.
- `npm run gateway:recovery-smoke` passed.
- `npm run model-smoke` passed.
