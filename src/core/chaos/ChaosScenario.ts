import type { ChaosScenarioId } from './ChaosTypes.js'
export const CHAOS_SCENARIOS: ChaosScenarioId[] = ['daemon_tick','gateway_inbound_duplicate','gateway_outbound_retry','model_rate_limit_simulated','gui_stuck_mock','durable_corrupt_jsonl','stale_heartbeat','replay_incident','loop_recovery_requires_human','tool_timeout','memory_growth_sample','process_restart_marker']
