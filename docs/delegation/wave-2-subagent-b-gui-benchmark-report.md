# Wave 2 SubAgent B GUI Benchmark Report

Status: implemented baseline; real Dingxu benchmark is partial/skipped unless explicitly enabled.

## Delivered
- `src/core/gui-benchmark/*`
- `benchmarks/gui-real/*`
- `scripts/gui-benchmark-smoke.mjs`
- `scripts/gui-real-probe-smoke.mjs`
- `scripts/gui-recovery-benchmark-smoke.mjs`
- `docs/productization/dingxu-gui-benchmark.md`

## Evidence
- Mock click benchmark passes.
- Mock stuck benchmark records `stuckDetected=true` and input release evidence.
- Approval benchmark waits for approval instead of executing write action.
- Real Dingxu probe returns `skipped_real_gui` without `PANDO_GUI_REAL=1`.

## Partial Boundaries
- Live Windows/Dingxu success rate is not proven by default smoke.
- No screenshot base64 is stored in events or reports.
