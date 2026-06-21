import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CHAOS_SCENARIOS } from './ChaosScenario.js'
import { runChaosFault } from './ChaosFaults.js'
import { summarizeChaosResults } from './ChaosMetrics.js'
import { writeChaosReport } from './ChaosReport.js'
import type { ChaosRunReport, ChaosRunnerOptions } from './ChaosTypes.js'
export class ChaosRunner {
  private readonly now: () => number
  constructor(private readonly options: ChaosRunnerOptions) { this.now = options.now ?? (() => Date.now()) }
  async run(): Promise<ChaosRunReport> {
    const startedAtMs = this.now(); const durationMs = Math.max(1, this.options.durationMs ?? 1000); const intervalMs = Math.max(0, this.options.intervalMs ?? 0); const maxIterations = Math.max(1, this.options.maxIterations ?? 6)
    await mkdir(resolve(this.options.workspaceRoot, '.pandoshare', 'chaos'), { recursive: true })
    const results = []
    for (let index = 0; index < maxIterations; index += 1) { if (this.now() - startedAtMs >= durationMs && results.length >= 6) break; const scenario = CHAOS_SCENARIOS[(index + (this.options.seed ?? 0)) % CHAOS_SCENARIOS.length]; results.push(runChaosFault(scenario, index)); if (intervalMs > 0) await delay(intervalMs) }
    const completedAtMs = this.now(); const report = { runId: 'chaos_' + Math.trunc(startedAtMs).toString(36), ...summarizeChaosResults(results, startedAtMs, completedAtMs), results }
    await writeChaosReport(this.options.workspaceRoot, report); return report
  }
}
function delay(ms: number): Promise<void> { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)) }
