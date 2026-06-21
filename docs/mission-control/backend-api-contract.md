# Mission Control Backend API Contract

Mission Control is a backend-only contract for a future operator UI. It is local-dev only in this baseline and does not add authentication.

## Endpoints

- GET /api/mission-control/overview
- GET /api/mission-control/active
- GET /api/mission-control/health
- GET /api/mission-control/runs
- GET /api/mission-control/loops
- GET /api/mission-control/gateway
- GET /api/mission-control/gui
- GET /api/mission-control/models
- GET /api/mission-control/replay
- GET /api/mission-control/approvals
- GET /api/mission-control/events
- POST /api/mission-control/action

Every response includes requestId, ok, data, warnings, and eventIds where available. Action calls are routed through BackendService.

## Security Boundary

Responses are redacted before leaving the Mission Control service. This baseline is not production-authenticated and must stay bound to local development until an owner chooses an auth strategy.
