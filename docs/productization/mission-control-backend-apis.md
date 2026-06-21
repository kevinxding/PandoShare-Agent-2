# Mission Control Backend APIs

Status: implemented baseline.

This phase adds a stable backend API surface for future Mission Control UI work without creating any Web UI. The service summarizes backend, durable, loop, GUI, gateway, model, replay, approvals, cost, incidents, and recent event state. Live runtime projection is intentionally conservative: empty arrays keep contract shape while real stores are wired incrementally.

Acceptance evidence:

- npm run mission:contract-smoke
- npm run mission:action-smoke
- npm run mission:api-smoke

Known limitations:

- Local-dev only; no authentication system is introduced in this phase.
- Some projections are baseline placeholders until always-on runtime stores are connected.
