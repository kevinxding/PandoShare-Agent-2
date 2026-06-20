# GUI Runtime V2

## Responsibility Boundary

GUI Runtime V2 is the durable execution kernel for real desktop actions. It owns observation capture, stable action envelopes, approval classification, execution lease, action execution, post-action verification, stuck detection, durable audit trail, recovery decisions, and replay-friendly timeline data.

GUI Runtime does not own model inference, loop scheduling, gateway messages, Web UI rendering, long-term goals, or permission bypasses. Loop and Gateway can drive GUI work later by issuing stable GUI actions; raw Dingxu tools stay behind the adapter.

## Stable gui_action Contract

The model-facing action contract is `GuiRuntimeAction`: action, target/text/keys/coordinates/points/region, timeout, verification request, risk hint, approval policy, expected change, idempotency key, and metadata. It is stable even when the backend is Dingxu, Windows MCP, human_gui, or a mock adapter.

Raw Dingxu tools are not exposed to models because they are backend-specific, broad, and too easy to call without approval, verification, or recovery state. `DingxuGuiAdapter` maps stable actions to legacy `runGuiAction` and reports compact summaries.

## Event Contract

GUI V2 durable events are:

- `gui_observation_started`
- `gui_observation_completed`
- `gui_action_requested`
- `gui_action_approval_required`
- `gui_action_approved`
- `gui_action_rejected`
- `gui_action_started`
- `gui_action_completed`
- `gui_action_failed`
- `gui_action_verified`
- `gui_action_stuck`
- `gui_action_recovery_decided`
- `gui_input_released`
- `gui_legacy_event_bridged`

Payloads store refs and summaries such as `screenshotRef`, `observationId`, action summary, verification summary, and risk. They must not embed large screenshot base64.

## Action State Machine

States are `requested`, `waiting_approval`, `approved`, `rejected`, `running`, `completed`, `failed`, `verified`, `stuck`, and `recovery_required`.

Rejected actions are never executed. Stuck and failed write actions are not treated as safe replay. Terminal state should not be silently overwritten by later success events.

## Approval Policy

Risk classes:

| Risk | Examples | Default approval |
| --- | --- | --- |
| `read_only` | observe, screenshot, compare, analyze_grid | no |
| `low_write` | move_mouse, hover, focus | no |
| `write` | click, type, hotkey, drag, draw, key state | yes unless trusted |
| `dangerous_write` | submit, delete, publish, payment, install, unknown | always yes unless explicit trusted policy |

`approvalPolicy=ask` records waiting approval. `approvalPolicy=never` rejects required write actions. `approvalPolicy=trusted` records policy approval and allows execution.

## Lease And Stuck Detection

Write actions acquire a durable GUI lease so only one write action runs per workspace by default. Read-only actions do not need a write lease. Timeout writes `gui_action_stuck`, releases input through the adapter when possible, writes `gui_input_released`, and creates an unsafe checkpoint.

## Recovery Matrix

| State or effect | Recovery decision |
| --- | --- |
| completed or verified | `already_completed` |
| stuck | `requires_human` |
| write or dangerous write not completed | `requires_human` |
| read-only failed action | `recoverable_readonly` |

Durable checkpoints for GUI writes include `gui_write` or `gui_dangerous_write` pending effects. Durable recovery therefore returns `requires_human` for unsafe GUI write state.

## Replay Timeline

`ReplayReport` now emits a GUI Timeline section when durable GUI events are present. The timeline includes guiActionId, action, state, risk, approval, observation refs, verification status, screenshot refs, and checkpoint refs.

## Legacy GuiTool Migration Path

`GuiTool` keeps the legacy `runGuiAction` path for compatibility. When `metadata.coreGuiRuntime` or `metadata.enableCoreGuiRuntime` is present, it routes through core `GuiRuntime` and returns `guiActionId`, state, verification, event ids, risk, and checkpoint id.

## Unfinished Items

- real Web approval UI
- remote GUI streaming
- complex visual diffing
- GUI sub-agent verifier
- multi-window app context
- full Dingxu observation metadata normalization
