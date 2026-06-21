# SubAgent C Benchmark Report

Status: completed.

## Delivered
- Benchmark types, loader, runner, scorer, store, and report writer under `src/core/benchmark/`.
- Offline benchmark manifest under `benchmarks/benchmark-manifest.json`.
- Category smokes for code, loop, gateway, GUI, and full report generation.

## Validation
- `npm run benchmark:smoke`
- `npm run benchmark:code-smoke`
- `npm run benchmark:loop-smoke`
- `npm run benchmark:gateway-smoke`
- `npm run benchmark:gui-smoke`
- `npm run benchmark:report-smoke`

## Limits
- These are deterministic offline evaluation fixtures; live model and live GUI benchmarks are not part of this phase.
