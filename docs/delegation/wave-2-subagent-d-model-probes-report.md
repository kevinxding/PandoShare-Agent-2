# Wave 2 SubAgent D Model Probes Report

Status: implemented baseline; online provider probes are partial/skipped unless explicitly enabled.

## Delivered
- `src/core/model-probe/*`
- `scripts/model-probe-smoke.mjs`
- `scripts/model-probe-offline-smoke.mjs`
- `scripts/model-probe-report-smoke.mjs`
- `scripts/model-probe-fallback-smoke.mjs`
- `docs/productization/model-production-probes.md`

## Evidence
- Offline probes list providers, models, and profiles.
- Missing auth is recorded as `missing_auth` rather than a crash.
- Fallback simulation produces selected and fallback chain evidence.
- Unknown price remains unknown.
- Reports redact secret-like values.
- Online minimal probe is skipped by default.

## Partial Boundaries
- No default network calls.
- No default real token spend.
- No external provider catalog dependency.
