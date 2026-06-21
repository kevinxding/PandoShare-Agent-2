import { mkdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { DurableRuntime } from '../durable/index.js'
import { GuiRuntime, type GuiRuntimeActionRecord } from '../gui/index.js'
import { GuiDingxuProbe } from './GuiDingxuProbe.js'
import { GuiBenchmarkReport } from './GuiBenchmarkReport.js'
import { GuiBenchmarkScenarioLoader } from './GuiBenchmarkScenario.js'
import { GuiBenchmarkScorer } from './GuiBenchmarkScorer.js'
import { GuiMockScenarioAdapter } from './GuiMockScenarioAdapter.js'
import type { GuiBenchmarkRecoveryDecision, GuiBenchmarkRunResult, GuiBenchmarkScenario, GuiBenchmarkScenarioResult } from './GuiBenchmarkTypes.js'

export type GuiBenchmarkRunnerOptions = {
  workspaceRoot: string
  manifestPath: string
  outputDir?: string
  runId?: string
  nowMs?: number
  ids?: string[]
  env?: Record<string, string | undefined>
}

export class GuiBenchmarkRunner {
  constructor(
    readonly options: GuiBenchmarkRunnerOptions,
    readonly loader = new GuiBenchmarkScenarioLoader(),
    readonly scorer = new GuiBenchmarkScorer(),
    readonly dingxuProbe = new GuiDingxuProbe(),
  ) {}

  async run(): Promise<GuiBenchmarkRunResult> {
    const manifestPath = resolve(this.options.manifestPath)
    const workspaceRoot = resolve(this.options.workspaceRoot)
    const { manifest, scenarios } = await this.loader.loadManifest(manifestPath)
    const selected = this.filterScenarios(scenarios)
    if (selected.length === 0) throw new Error('No GUI benchmark scenarios matched runner filters')
    const generatedAtMs = this.options.nowMs ?? Date.now()
    const runId = this.options.runId ?? `gui_benchmark_${generatedAtMs}_${Math.random().toString(36).slice(2, 10)}`
    const results: GuiBenchmarkScenarioResult[] = []
    for (const item of selected) {
      results.push(await this.runScenario({ scenario: item.scenario, scenarioPath: item.scenarioPath, workspaceRoot, runId }))
    }
    const passedCount = results.filter(result => result.status === 'passed').length
    const failedCount = results.filter(result => result.status === 'failed').length
    const skippedCount = results.filter(result => result.status === 'skipped').length
    const partialCount = results.filter(result => result.status === 'partial').length
    const executedCount = results.length - skippedCount
    const run: GuiBenchmarkRunResult = {
      runId,
      manifestPath,
      manifestName: manifest.name,
      generatedAtMs,
      status: failedCount > 0 ? 'failed' : skippedCount > 0 || partialCount > 0 ? 'partial' : 'passed',
      scenarioCount: results.length,
      passedCount,
      failedCount,
      skippedCount,
      partialCount,
      executedCount,
      successRate: executedCount > 0 ? passedCount / executedCount : 0,
      results,
    }
    if (this.options.outputDir) {
      const files = await GuiBenchmarkReport.write(run, this.options.outputDir)
      return { ...run, files }
    }
    return run
  }

  private filterScenarios(items: { scenario: GuiBenchmarkScenario; scenarioPath: string }[]): { scenario: GuiBenchmarkScenario; scenarioPath: string }[] {
    const idSet = this.options.ids ? new Set(this.options.ids) : undefined
    return items.filter(item => !idSet || idSet.has(item.scenario.id))
  }

  private async runScenario(input: { scenario: GuiBenchmarkScenario; scenarioPath: string; workspaceRoot: string; runId: string }): Promise<GuiBenchmarkScenarioResult> {
    if (input.scenario.mode === 'real_dingxu') {
      const probe = await this.dingxuProbe.probe({ workspaceRoot: input.workspaceRoot, env: this.options.env })
      return this.scorer.fromProbe({ scenario: input.scenario, scenarioPath: input.scenarioPath, probe })
    }
    return this.runMockScenario(input)
  }

  private async runMockScenario(input: { scenario: GuiBenchmarkScenario; scenarioPath: string; workspaceRoot: string; runId: string }): Promise<GuiBenchmarkScenarioResult> {
    const scenarioRoot = resolve(input.workspaceRoot, '.gui-benchmark-runtime', safeSegment(input.runId), safeSegment(input.scenario.id))
    assertInside(input.workspaceRoot, scenarioRoot)
    await mkdir(scenarioRoot, { recursive: true })
    const adapter = new GuiMockScenarioAdapter(input.scenario)
    const runtime = new GuiRuntime({ workspaceRoot: scenarioRoot, workspaceId: 'default', adapter, defaultApprovalPolicy: 'ask' })
    const durable = new DurableRuntime({ workspaceRoot: scenarioRoot, workspaceId: 'default' })
    const scenarioRunId = `${input.runId}_${safeSegment(input.scenario.id)}`
    const startedAtMs = Date.now()
    let record: GuiRuntimeActionRecord | undefined
    let recoveryDecision: GuiBenchmarkRecoveryDecision | undefined
    if (!input.scenario.action && input.scenario.type === 'observe_health') {
      await runtime.observe({ source: 'test', runId: scenarioRunId })
    } else if (!input.scenario.action) {
      throw new Error(`GUI benchmark scenario ${input.scenario.id} requires action`)
    } else if (input.scenario.type === 'approval_required') {
      record = await runtime.requestAction(input.scenario.action, { source: 'test', runId: scenarioRunId })
    } else {
      record = await runtime.act(input.scenario.action, { source: 'test', runId: scenarioRunId })
      if (record.state === 'stuck') {
        const recovery = await runtime.recoverGuiAction(record.identity.guiActionId)
        recoveryDecision = recovery.decision
      }
    }
    const events = await durable.readEvents({ runId: scenarioRunId })
    return this.scorer.fromRuntime({
      scenario: input.scenario,
      scenarioPath: input.scenarioPath,
      durationMs: Date.now() - startedAtMs,
      record,
      events,
      stats: adapter.stats,
      recoveryDecision,
    })
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'scenario'
}

function assertInside(rootPath: string, targetPath: string): void {
  const root = resolve(rootPath)
  const target = resolve(targetPath)
  const rel = relative(root, target)
  if (rel.startsWith('..') || rel === '' || resolve(root, rel) !== target) throw new Error(`Refusing to use path outside workspace: ${target}`)
}
