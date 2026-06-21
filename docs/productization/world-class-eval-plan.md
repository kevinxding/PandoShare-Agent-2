# World-Class Evaluation Plan

## Evaluation layers
1. Contract smoke: verify each kernel module can be imported and used directly.
2. Fixture smoke: verify deterministic offline task behavior with no external model calls.
3. Benchmark pack: score representative code, loop, gateway, GUI, replay, and model-routing cases.
4. Acceptance report: produce a generated pass/fail report for all kernel and productization gates.
5. Long-run validation: run stability scripts after backend/productization gates are green.

## Current v1 gate
`npm run acceptance:full` now includes the productization smoke gates in addition to the original kernel, GUI, gateway, model, replay, and reality checks.

## Not included yet
- Real model-driven code repair benchmark.
- Live GUI automation benchmark against the latest Dingxu agent backend.
- 10-hour unattended stability run for the new productization facade.
