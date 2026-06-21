import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { GuiBenchmarkRunFiles, GuiBenchmarkRunResult, GuiBenchmarkScenarioResult } from './GuiBenchmarkTypes.js'

export class GuiBenchmarkReport {
  static filesFor(outputDir: string): GuiBenchmarkRunFiles {
    const resolved = resolve(outputDir)
    return {
      jsonPath: join(resolved, 'gui-benchmark-result.json'),
      markdownPath: join(resolved, 'gui-benchmark-report.md'),
    }
  }

  static async write(run: GuiBenchmarkRunResult, outputDir: string): Promise<GuiBenchmarkRunFiles> {
    const files = GuiBenchmarkReport.filesFor(outputDir)
    await mkdir(outputDir, { recursive: true })
    await writeFile(files.jsonPath, `${JSON.stringify({ summary: summarize(run), run }, null, 2)}\n`, 'utf8')
    await writeFile(files.markdownPath, GuiBenchmarkReport.toMarkdown(run), 'utf8')
    return files
  }

  static toMarkdown(run: GuiBenchmarkRunResult): string {
    const successRate = `${(run.successRate * 100).toFixed(2)}%`
    return [
      '# Dingxu GUI Benchmark Report',
      '',
      `Status: ${run.status}`,
      `Success rate: ${successRate} (${run.passedCount}/${run.executedCount} executed; ${run.skippedCount} skipped; ${run.partialCount} partial)`,
      `Scenarios: ${run.scenarioCount}`,
      `Run ID: ${run.runId}`,
      '',
      '## Scenarios',
      '',
      '| ID | Type | Mode | Status | Verification | Stuck | Released | Approval | Recovery |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...run.results.map(result => scenarioLine(result)),
      '',
      '## Replay References',
      '',
      ...replayLines(run.results),
      '',
      '## Partials And Skips',
      '',
      ...partialLines(run.results),
      '',
    ].join('\n')
  }
}

function summarize(run: GuiBenchmarkRunResult): Record<string, unknown> {
  return {
    status: run.status,
    scenarioCount: run.scenarioCount,
    passedCount: run.passedCount,
    failedCount: run.failedCount,
    skippedCount: run.skippedCount,
    partialCount: run.partialCount,
    executedCount: run.executedCount,
    successRate: run.successRate,
  }
}

function scenarioLine(result: GuiBenchmarkScenarioResult): string {
  const metrics = result.metrics
  return `| ${result.id} | ${result.type} | ${result.mode} | ${result.status} | ${metrics.verificationStatus} | ${metrics.stuckDetected} | ${metrics.inputReleased} | ${metrics.approvalRequired} | ${metrics.recoveryDecision ?? 'none'} |`
}

function replayLines(results: GuiBenchmarkScenarioResult[]): string[] {
  const lines: string[] = []
  for (const result of results) {
    if (!result.replayRefs.length) continue
    lines.push(`- ${result.id}: ${result.replayRefs.map(ref => ref.ref).join(', ')}`)
  }
  return lines.length ? lines : ['No replay refs emitted.']
}

function partialLines(results: GuiBenchmarkScenarioResult[]): string[] {
  const partials = results.filter(result => result.status === 'skipped' || result.status === 'partial')
  if (!partials.length) return ['No partial or skipped scenarios.']
  return partials.map(result => `- ${result.id}: ${result.status} (${result.metrics.failureReason ?? result.evidence?.dingxuProbeCode ?? 'no failure reason'})`)
}
