# Gateway Daemon V2

Gateway Daemon V2 is the durable external control plane for long-running Pando operation. It turns external messages and operator commands into durable command, approval, wake, delivery, heartbeat, and recovery events.

## Responsibility Boundary

Gateway Daemon V2 owns:

- external inbound messages
- channel identity and pairing
- command routing
- durable inbound queue
- durable outbound queue
- delivery retry and backoff
- approval routing
- loop wake and background task trigger
- GUI approval forwarding
- recovery escalation
- heartbeat and health report
- channel adapter lifecycle
- operator-visible status

Gateway Daemon V2 does not own:

- model inference
- tool execution
- GUI direct execution
- Loop internals scheduling
- ThreadStore truth
- Web UI rendering
- provider selection algorithms
- unsafe auto replay

## Event Contract

Gateway events are fine-grained durable events. The V2 constants live in `src/core/gateway/GatewayEventTypes.ts` and include daemon lifecycle, heartbeat, channel, inbound, command, outbound, delivery retry, pairing, approval, wake, GUI approval, recovery, health, and legacy bridge events.

Every Gateway V2 event is written through `DurableRuntime.appendEvent`. Payloads include `workspaceId` through the durable envelope and carry gateway/session ids where available. Payloads summarize text and delivery data and must not include tokens, webhook URLs, cookies, or secrets.

## Envelope And Dedupe

`GatewayInboundEnvelope` stores `inboundId`, `dedupeKey`, `channelId`, `channelKind`, optional `externalMessageId`, `userId`, text, timestamps, pairing/allow flags, safe `rawRef`, and metadata.

`GatewayOutboundEnvelope` stores `deliveryId`, `dedupeKey`, channel/user, optional reply id, text, delivery status, attempt count, retry time, timestamps, last error, and metadata.

Inbound dedupe prefers `externalMessageId`. If it is missing, the fallback key is channel/user/text plus a time bucket. Duplicate inbound writes `gateway_inbound_deduped` and is not dispatched again. Outbound retry keeps the same `deliveryId`.

## Queue State Machines

Inbound:

- received
- deduped or denied or pending
- routed
- dispatched or failed

Outbound:

- queued
- sending
- delivered
- retry_scheduled
- failed or skipped

The operational queue is append-only JSONL under `.pandoshare/core/queues`. Durable events remain the audit truth.

## Command Routing Matrix

- Plain text -> `agent.run`
- `/goal <objective>` -> `loop.create`
- `/resume <loopId>` -> `loop.resume`
- `/background <loopId>` -> `gateway.background.enroll`
- `/pause <loopId>` -> `loop.pause`
- `/stop [runId|loopId]` -> `agent.stop`, `loop.stop`, or `gateway.stop`
- `/approve <id>` and `/deny <id>` -> `approval.resolve`
- `/gui approve <id>` -> `gui.approve`
- `/gui deny <id>` -> `gui.reject`
- `/model` -> `gateway.model.status`
- `/model <provider> [model]` -> `gateway.model.switch`
- `/usage`, `/status`, `/health`, `/threads`, `/loops`, `/loop`, `/compress`, `/replay`, `/pair`, `/unpair`, `/help` route to explicit command envelopes.
- Unknown slash commands route to `gateway.command.unknown` with a visible reply.

The router only creates `CommandEnvelope`; it does not execute commands.

## Dispatcher Boundary

`GatewayDispatcher` may call:

- `AgentKernel.submitRun`
- `LoopCommandHandler.handle`
- `GuiRuntime.approveGuiAction` / `rejectGuiAction`
- `GatewayApprovalBridge`
- Gateway-owned status, health, model, compact, replay, and background callbacks

It must not call `QueryEngine`, Dingxu raw tools, shell tools, network senders, or direct provider internals.

## Approval Bridge

`GatewayApprovalBridge` unifies:

- `agent_tool_approval`
- `loop_human_gate`
- `gui_action_approval`
- `recovery_decision`
- `gateway_delivery_retry`
- `model_switch_request`

Approvals can be listed, formatted for a channel, and resolved. Resolving writes `gateway_approval_resolved`. Unknown approval ids return explicit errors.

## Wake Scheduler

`GatewayWakeScheduler` supports heartbeat/explicit background loop enrollment. Each tick runs at most one loop command through `LoopCommandHandler`. It writes `gateway_loop_wake_requested` and `gateway_loop_wake_completed`.

## Retry And Backoff

`ReconnectPolicy` supports exponential backoff, deterministic jitter, max attempts, explicit `retryAfterMs`, and permanent failure classification. `missing_config` and permanent failures become `failed`; temporary/network/unknown failures become `retry_scheduled` until max attempts.

## Recovery Matrix

- `recoverable_auto`: Gateway records recovery state but does not replay unsafe external effects.
- `requires_human`: Gateway writes `gateway_recovery_escalated` and queues a local operator message.
- `mark_corrupted`: Gateway escalates to human handling.
- `already_completed`: no action.

Gateway does not auto-approve GUI write/dangerous actions and does not auto-replay gateway outbound effects.

## Legacy Migration Path

`src/services/gatewayRuntime` remains intact and powers the existing mature gateway smoke. `GatewayLegacyAdapter` reads legacy state, inbox, outbox, events, wake runs, and paired users, then bridges legacy events into `gateway_legacy_event_bridged` without changing old file formats.

## Unfinished Items

- Real long-running process manager
- System service installer
- Complex cron DSL
- Full real Telegram/Feishu/Lark/WeCom webhook integration
- Multi-workspace gateway supervisor
- Web approval UI
- Full replacement of legacy `src/services/gatewayRuntime`
