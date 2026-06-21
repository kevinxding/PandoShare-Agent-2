# Chaos Smoke Report

- Run: chaos_mqnjkc58
- Iterations: 6
- Recoveries: 5
- Failures: 1
- Incidents: 0

## Results

- daemon_tick: recovered - Scenario completed with baseline recovery evidence.
- gateway_inbound_duplicate: recovered - Duplicate inbound did not dispatch twice.
- gateway_outbound_retry: recovered - Scenario completed with baseline recovery evidence.
- model_rate_limit_simulated: recovered - Rate limit produced fallback evidence.
- gui_stuck_mock: recovered - Mock stuck GUI produced release evidence.
- durable_corrupt_jsonl: nonfatal - Corrupt JSONL was classified and skipped.
