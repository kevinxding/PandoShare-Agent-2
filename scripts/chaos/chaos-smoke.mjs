#!/usr/bin/env node
const core = await import('../../dist/src/core/index.js')
const report = await new core.ChaosRunner({ workspaceRoot: process.cwd(), durationMs: 1000, intervalMs: 0, maxIterations: 6, seed: 0 }).run()
assert(report.iterations >= 6, 'chaos smoke must run at least six scenarios')
assert(report.results.some(r => r.scenarioId === 'gateway_inbound_duplicate' && r.metrics.dispatchCount === 1), 'gateway duplicate evidence missing')
assert(report.results.some(r => r.scenarioId === 'model_rate_limit_simulated' && r.metrics.fallbackUsed === true), 'model fallback evidence missing')
assert(report.results.some(r => r.scenarioId === 'gui_stuck_mock' && r.metrics.releasedInput === true), 'gui recovery evidence missing')
console.log('chaos smoke passed')
function assert(value, message) { if (!value) throw new Error(message) }
