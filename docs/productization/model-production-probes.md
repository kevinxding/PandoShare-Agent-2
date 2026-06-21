# Model Production Probes

## Status
Implemented offline/static/mock probe baseline, with online provider calls skipped by default.

## Scope
Model probes turn ModelRouter configuration into production health evidence: provider presence, auth presence, catalog shape, static capability, mock latency, budget estimate, fallback simulation, and optional online minimal checks.

## Source
- `src/core/model-probe/ModelProbeRunner.ts`
- `src/core/model-probe/ProviderProbe.ts`
- `src/core/model-probe/CapabilityProbe.ts`
- `src/core/model-probe/ProbeReport.ts`

## Guarantees
- Default probes are offline and do not spend user tokens.
- `online_minimal` requires `PANDO_MODEL_PROBE_ONLINE=1`.
- Missing API key state is recorded as `missing_auth`, not a crash.
- Reports redact API keys, tokens, authorization values, credentials, and secret-like values.
- Unknown model prices stay unknown; the system does not invent cost.
- Fallback simulation records selected and fallback chain evidence.

## Partial Boundaries
- Live provider latency and live model health are not certified by default smoke tests.
- Provider catalog is local/config-derived; no external provider catalog dependency is introduced.

## Validation
- `npm run model:probe-smoke`
- `npm run model:probe-offline-smoke`
- `npm run model:probe-report-smoke`
- `npm run model:probe-fallback-smoke`
