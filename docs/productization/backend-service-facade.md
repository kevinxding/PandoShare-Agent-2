# Backend Service Facade

## Scope
BackendService is the direct backend facade for the product kernel. It exposes a stable request/response contract above AgentKernel, LoopRuntime, GuiRuntime, GatewayDaemon, ModelRouter, ReplayService, and DurableRuntime.

## Interfaces
- Source: `src/core/backend/index.ts`
- Main class: `BackendService`
- Request type: `BackendRequest`
- Response type: `BackendResponse`
- Supported actions include agent, loop, gui, gateway, model, replay, and system health/acceptance actions.

## Current guarantees
- Every handled request records started/completed/failed telemetry through DurableRuntime.
- Errors are normalized into backend error responses after request normalization.
- `system.health` verifies the configured kernel adapters.
- `system.acceptance` exposes the backend contract checks used by smoke tests.

## Validation
- `npm run backend:service-smoke`
- `npm run backend:contract-smoke`
