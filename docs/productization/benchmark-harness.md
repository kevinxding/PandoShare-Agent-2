# Benchmark Harness

## Scope
The benchmark harness is an offline evaluation pack for code, loop, gateway, GUI, replay, and model-routing behavior.

## Interfaces
- Source: `src/core/benchmark/index.ts`
- Manifest: `benchmarks/benchmark-manifest.json`
- Runner: `BenchmarkRunner`
- Report writer: `BenchmarkReport`

## Current guarantees
- Loads benchmark manifests and fixture JSON files deterministically.
- Filters by category or case id.
- Scores expected output fields using equality, contains, not_contains, array_contains, exists, and numeric_gte operators.
- Writes JSON, Markdown, and JSONL run records when an output directory is provided.

## Validation
- `npm run benchmark:smoke`
- `npm run benchmark:code-smoke`
- `npm run benchmark:loop-smoke`
- `npm run benchmark:gateway-smoke`
- `npm run benchmark:gui-smoke`
- `npm run benchmark:report-smoke`
