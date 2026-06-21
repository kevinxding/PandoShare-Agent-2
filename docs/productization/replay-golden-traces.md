# Replay Golden Traces

Replay golden traces are deterministic fixtures for Event Replay V2. They prove that the replay loader, graph builder, incident detector, projections, artifact manifest, Markdown renderer, and diff layer keep stable operator-facing behavior across productization work.

## Scope

The baseline lives in `golden-traces/`. Each trace directory contains:

- `events.jsonl`: deterministic, secret-free EventEnvelope records.
- `expected-report-shape.json`: stable report shape, projection statuses, metrics, required Markdown sections, artifact kinds, and redaction counts.
- `expected-incidents.json`: exact expected incident kind, severity, event ids, and important ids.
- `expected-graph-summary.json`: graph node/edge/root/leaf/orphan counts plus edge type counts.
- `artifacts-manifest.json`: expected artifact refs only, never artifact bodies.
- `README.md`: short operator intent for the trace.

The validator intentionally does not compare exact generated report timestamps or generated report ids. Fixture event timestamps are fixed historical values and update mode must be explicit.

## Update Policy

Default validation is read-only. `updateGoldenTrace()` and `updateAllGoldenTraces()` return candidate file contents without writing unless called with `{ write: true }`. The smoke `scripts/replay-golden-update-dry-run.mjs` asserts that dry-run update mode does not modify files.

Golden traces must remain:

- deterministic;
- free of raw authorization, cookies, webhook URLs, API keys, bearer strings, pairing secrets, and password-like fields;
- independent of current timestamps;
- focused on replay behavior, not Web UI behavior.

## Baseline Traces

- `run-basic`: minimal successful run with checkpoint and no incidents.
- `loop-gui-gateway-model`: cross-core loop, GUI, gateway, model, tool, checkpoint, and artifact refs.
- `incident-duplicate-terminal`: duplicate run terminal event detection.
- `unsafe-recovery`: pending external effect plus unsafe auto recovery detection.
- `model-fallback`: model rate limit and fallback exhaustion detection.
- `gateway-delivery-retry`: failed gateway delivery plus retry exhaustion detection.

## Validation

After build, run:

```sh
node scripts/replay-golden-smoke.mjs
node scripts/replay-golden-diff-smoke.mjs
node scripts/replay-golden-report-smoke.mjs
node scripts/replay-golden-update-dry-run.mjs
```

The main smoke requires at least six traces, validates report shape, incidents, graph summary, artifact manifest, deterministic fixture safety, and verifies ReplayService can build a report from imported golden events.
