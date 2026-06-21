# Dingxu GUI Benchmark

## Status
Implemented baseline, with real desktop execution gated and skipped by default.

## Scope
The GUI benchmark layer measures mock and optionally Dingxu-backed GUI behavior without making real desktop actions the default path.

## Source
- `src/core/gui-benchmark/GuiBenchmarkRunner.ts`
- `src/core/gui-benchmark/GuiDingxuProbe.ts`
- `src/core/gui-benchmark/GuiMockScenarioAdapter.ts`
- `benchmarks/gui-real/gui-benchmark-manifest.json`

## Guarantees
- Mock scenarios run without Windows, Dingxu, or real desktop input.
- Real Dingxu probing requires `PANDO_GUI_REAL=1`.
- Missing real Dingxu environment returns `skipped_real_gui`, not a crash.
- Stuck recovery scenarios record `stuckDetected` and `inputReleased` evidence.
- Approval scenarios wait for approval and do not execute GUI write actions by default.
- Reports include success rate and replay-style refs without screenshot base64 payloads.

## Partial Boundaries
- Real Dingxu success rate is not certified by default smoke tests.
- Focus reliability against live Windows apps still needs explicit live benchmark runs.

## Validation
- `npm run gui:benchmark-smoke`
- `npm run gui:real-probe-smoke`
- `npm run gui:recovery-benchmark-smoke`
