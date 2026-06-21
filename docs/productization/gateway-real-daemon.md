# Gateway Real Daemon

## Status
Implemented foreground daemon baseline, with real external channel sending out of scope by default.

## Scope
The daemon layer prepares always-on local process boundaries for GatewayDaemon without installing an OS service or listening publicly by default.

## Source
- `src/core/daemon/DaemonProcess.ts`
- `src/core/daemon/Watchdog.ts`
- `src/core/gateway-daemon-service/GatewayServiceRuntime.ts`
- `src/core/gateway-daemon-service/GatewayWebhookServer.ts`

## Guarantees
- Foreground daemon runs write PID, heartbeat, graceful stop, and crash markers.
- Watchdog can detect stale heartbeat/PID state.
- Gateway service ticks a bounded number of times for smoke tests.
- Mock inbound webhook requires an ingress secret and queues messages locally.
- Outbound retry advances through service ticks with mock adapters.
- No background spawn happens unless explicitly requested by future callers.

## Partial Boundaries
- No OS service install is implemented.
- Telegram, Feishu, Enterprise WeChat, and public webhook deployment are not enabled by default.

## Validation
- `npm run daemon:foreground-smoke`
- `npm run gateway:service-smoke`
- `npm run gateway:webhook-smoke`
- `npm run gateway:watchdog-smoke`
