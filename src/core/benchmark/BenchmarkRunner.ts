import { resolve } from 'node:path'
import { BenchmarkFixtureLoader } from './BenchmarkFixtureLoader.js'
import { BenchmarkReport } from './BenchmarkReport.js'
import { BenchmarkScorer } from './BenchmarkScorer.js'
import { BenchmarkStore } from './BenchmarkStore.js'
import type { BenchmarkCase, BenchmarkCategory, BenchmarkRunResult } from './BenchmarkTypes.js'

export type BenchmarkRunnerOptions = {
  manifestPath: string
  outputDir?: string
  runId?: string
  nowMs?: number
  categories?: BenchmarkCategory[]
  ids?: string[]
}

export class BenchmarkRunner {
  constructor(
    readonly options: BenchmarkRunnerOptions,
    readonly fixtureLoader = new BenchmarkFixtureLoader(),
    readonly scorer = new BenchmarkScorer(),
  ) {}

  async run(): Promise<BenchmarkRunResult> {
    const manifestPath = resolve(this.options.manifestPath)
    const { manifest, cases } = await this.fixtureLoader.loadCases(manifestPath)
    const selectedCases = filterCases(cases, this.options)
    if (selectedCases.length === 0) throw new Error('No benchmark cases matched the runner filters')
    const results = selectedCases.map(benchmarkCase => this.scorer.score(benchmarkCase.fixture))
    const maxScore = results.reduce((total, result) => total + result.maxScore, 0)
    const score = results.reduce((total, result) => total + result.score, 0)
    const passedCount = results.filter(result => result.status === 'passed').length
    const generatedAtMs = this.options.nowMs ?? Date.now()
    const files = this.options.outputDir ? BenchmarkReport.filesFor(this.options.outputDir) : undefined
    const run: BenchmarkRunResult = {
      runId: this.options.runId ?? `benchmark_${generatedAtMs}_${Math.random().toString(36).slice(2, 10)}`,
      manifestPath,
      manifestName: manifest.name,
      generatedAtMs,
      status: passedCount === results.length ? 'passed' : 'failed',
      caseCount: results.length,
      passedCount,
      failedCount: results.length - passedCount,
      score,
      maxScore,
      results,
      files,
    }
    if (this.options.outputDir && files) {
      await new BenchmarkStore(files.jsonlPath).appendRun(run)
      await BenchmarkReport.write(run, this.options.outputDir)
    }
    return run
  }
}

function filterCases(cases: BenchmarkCase[], options: BenchmarkRunnerOptions): BenchmarkCase[] {
  const categorySet = options.categories ? new Set(options.categories) : undefined
  const idSet = options.ids ? new Set(options.ids) : undefined
  return cases.filter(benchmarkCase => {
    if (categorySet && !categorySet.has(benchmarkCase.fixture.category)) return false
    if (idSet && !idSet.has(benchmarkCase.fixture.id)) return false
    return true
  })
}
