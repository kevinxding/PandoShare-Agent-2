import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { BenchmarkCaseResult, BenchmarkReportSummary, BenchmarkRunFiles, BenchmarkRunResult } from './BenchmarkTypes.js'

export class BenchmarkReport {
  static summarize(run: BenchmarkRunResult): BenchmarkReportSummary {
    return {
      status: run.status,
      caseCount: run.caseCount,
      passedCount: run.passedCount,
      failedCount: run.failedCount,
      score: run.score,
      maxScore: run.maxScore,
      failedIds: run.results.filter(result => result.status === 'failed').map(result => result.id),
    }
  }

  static filesFor(outputDir: string): BenchmarkRunFiles {
    const resolvedDir = resolve(outputDir)
    return {
      jsonPath: join(resolvedDir, 'benchmark-result.json'),
      markdownPath: join(resolvedDir, 'benchmark-report.md'),
      jsonlPath: join(resolvedDir, 'benchmark-runs.jsonl'),
    }
  }

  static async write(run: BenchmarkRunResult, outputDir: string): Promise<BenchmarkRunFiles> {
    const files = BenchmarkReport.filesFor(outputDir)
    await mkdir(outputDir, { recursive: true })
    await writeFile(files.jsonPath, `${JSON.stringify({ summary: BenchmarkReport.summarize(run), run }, null, 2)}\n`, 'utf8')
    await writeFile(files.markdownPath, BenchmarkReport.toMarkdown(run), 'utf8')
    return files
  }

  static toMarkdown(run: BenchmarkRunResult): string {
    const lines = [
      '# Benchmark Report',
      '',
      `Status: ${run.status}`,
      `Score: ${run.score} / ${run.maxScore}`,
      `Cases: ${run.passedCount} passed, ${run.failedCount} failed, ${run.caseCount} total`,
      `Run ID: ${run.runId}`,
      '',
      '## Cases',
      '',
      '| ID | Category | Status | Score |',
      '| --- | --- | --- | --- |',
      ...run.results.map(result => `| ${result.id} | ${result.category} | ${result.status} | ${result.score} / ${result.maxScore} |`),
      '',
      '## Failed Expectations',
      '',
      ...failedExpectationLines(run.results),
    ]
    return `${lines.join('\n')}\n`
  }
}

function failedExpectationLines(results: BenchmarkCaseResult[]): string[] {
  const lines: string[] = []
  for (const result of results) {
    for (const expectation of result.expectationResults) {
      if (!expectation.passed) lines.push(`- ${result.id}: ${expectation.name} - ${expectation.message}`)
    }
  }
  return lines.length > 0 ? lines : ['No failed expectations.']
}
