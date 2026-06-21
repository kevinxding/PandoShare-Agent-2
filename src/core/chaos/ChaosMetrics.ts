import type { ChaosRunReport, ChaosScenarioResult } from './ChaosTypes.js'
export function summarizeChaosResults(results: readonly ChaosScenarioResult[], startedAtMs: number, completedAtMs: number): Omit<ChaosRunReport, 'runId' | 'results'> {
  return { startedAtMs, completedAtMs, durationMs: Math.max(0, completedAtMs - startedAtMs), iterations: results.length, events: results.length, failures: results.filter(result => result.status !== 'recovered').length, recoveries: results.filter(result => result.status === 'recovered').length, incidents: results.filter(result => result.status === 'fatal').length, memoryRss: runtimeMemoryRss() }
}
function runtimeMemoryRss(): number { const runtime = globalThis as unknown as { process?: { memoryUsage?: () => { rss?: number } } }; return runtime.process?.memoryUsage?.().rss ?? 0 }
