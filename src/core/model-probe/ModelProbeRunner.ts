import { resolve } from 'node:path'
import { generateText, LLMProviderError } from '../../services/llm/client.js'
import { ModelRouter } from '../model/ModelRouter.js'
import { summarizeModelProbeModels, summarizeModelProbeProfiles, runCapabilityStaticProbe, runCatalogShapeProbe } from './CapabilityProbe.js'
import { runBudgetEstimateProbe, runFallbackSimulationProbe } from './CostProbe.js'
import { runLatencyMockProbe } from './LatencyProbe.js'
import {
  createModelProbeResult,
  summarizeModelProbeResults,
  type ModelProbeOptions,
  type ModelProbeResult,
  type ModelProbeRun,
} from './ModelProbeTypes.js'
import { ProbeReport } from './ProbeReport.js'
import { ProbeStore } from './ProbeStore.js'
import { runAuthPresenceProbe, runConfigProbe, summarizeModelProbeProviders } from './ProviderProbe.js'

type RuntimeEnv = {
  process?: {
    env?: Record<string, string | undefined>
  }
}

export class ModelProbeRunner {
  private readonly now: () => number

  constructor(private readonly options: ModelProbeOptions = {}) {
    this.now = options.now ?? (() => Date.now())
  }

  async run(): Promise<ModelProbeRun> {
    const createdAtMs = this.now()
    const workspaceRoot = this.options.workspaceRoot ?? '.'
    const workspaceId = this.options.workspaceId ?? 'default'
    const outputDir = this.options.outputDir ?? resolve(workspaceRoot, '.pandoshare', 'model-probes')
    const onlineEnabled = this.onlineEnabled()
    const router = ModelRouter.fromConfig(this.options.config ?? {}, {
      workspaceRoot,
      workspaceId,
      now: this.now,
    })

    let sequence = 0
    const nextSequence = () => {
      sequence += 1
      return sequence
    }
    const results: ModelProbeResult[] = []
    results.push(runConfigProbe({ router, sequence: nextSequence(), now: this.now }))
    results.push(runAuthPresenceProbe({ router, sequence: nextSequence(), now: this.now }))
    results.push(runCatalogShapeProbe({ router, sequence: nextSequence(), now: this.now }))
    results.push(runCapabilityStaticProbe({ router, sequence: nextSequence(), now: this.now }))
    results.push(runLatencyMockProbe({ router, sequence: nextSequence(), now: this.now }))
    results.push(await this.runOnlineMinimalProbe(router, nextSequence(), onlineEnabled))
    results.push(runBudgetEstimateProbe({ router, sequence: nextSequence(), now: this.now }))
    const fallback = runFallbackSimulationProbe({ router, sequence: nextSequence(), now: this.now })
    results.push(fallback.result)

    const completedAtMs = this.now()
    const files = ProbeReport.filesFor(outputDir)
    const run: ModelProbeRun = {
      runId: createRunId(createdAtMs),
      createdAtMs,
      completedAtMs,
      durationMs: Math.max(0, completedAtMs - createdAtMs),
      mode: onlineEnabled ? 'online' : 'offline',
      onlineEnabled,
      workspaceId,
      summary: summarizeModelProbeResults(results),
      providers: summarizeModelProbeProviders(router),
      models: summarizeModelProbeModels(router),
      profiles: summarizeModelProbeProfiles(router),
      fallbackChain: fallback.fallbackChain,
      results,
      partials: partialsFromResults(results),
      reportFiles: files,
    }

    await new ProbeStore({ path: files.jsonlPath }).append(run)
    await ProbeReport.write(run, outputDir)
    return run
  }

  private onlineEnabled(): boolean {
    if (this.options.online !== undefined) return this.options.online
    const env = (globalThis as unknown as RuntimeEnv).process?.env ?? {}
    return env.PANDO_MODEL_PROBE_ONLINE === '1'
  }

  private async runOnlineMinimalProbe(router: ModelRouter, sequence: number, onlineEnabled: boolean): Promise<ModelProbeResult> {
    const startedAtMs = this.now()
    if (!onlineEnabled) {
      return createModelProbeResult(sequence, {
        type: 'online_minimal',
        status: 'skipped',
        message: 'Skipped by default; set PANDO_MODEL_PROBE_ONLINE=1 to run a live minimal provider request.',
        startedAtMs,
        completedAtMs: this.now(),
      })
    }

    const candidate = router.listModels().find(model => !model.missingAuth)
    if (!candidate) {
      return createModelProbeResult(sequence, {
        type: 'online_minimal',
        status: 'missing_auth',
        message: 'Online minimal requested, but no model candidate has auth presence.',
        startedAtMs,
        completedAtMs: this.now(),
      })
    }

    const abort = new AbortController()
    const timeout = globalThis.setTimeout(() => abort.abort(), 10_000)
    try {
      const response = await generateText({
        model: { provider: candidate.provider, model: candidate.modelId },
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
        maxTokens: 8,
        temperature: 0,
      }, {
        retry: false,
        signal: abort.signal,
      })
      return createModelProbeResult(sequence, {
        type: 'online_minimal',
        status: 'passed',
        message: 'Online minimal provider request completed.',
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        startedAtMs,
        completedAtMs: this.now(),
        data: {
          textLength: response.text.length,
          hasUsage: response.usage !== undefined,
        },
      })
    } catch (error) {
      return createModelProbeResult(sequence, {
        type: 'online_minimal',
        status: 'degraded',
        message: `Online minimal provider request degraded: ${safeOnlineErrorMessage(error)}`,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        startedAtMs,
        completedAtMs: this.now(),
        data: onlineErrorData(error),
      })
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }
}

export async function runModelProbes(options: ModelProbeOptions = {}): Promise<ModelProbeRun> {
  return new ModelProbeRunner(options).run()
}

function partialsFromResults(results: readonly ModelProbeResult[]): string[] {
  return results.flatMap(result => {
    if (result.status === 'passed') return []
    return [`${result.type}: ${result.status} - ${result.message}`]
  })
}

function createRunId(createdAtMs: number): string {
  return `model_probe_${Math.trunc(createdAtMs).toString(36)}`
}

function safeOnlineErrorMessage(error: unknown): string {
  if (error instanceof LLMProviderError) return `${error.category}${error.status ? ` status=${error.status}` : ''}`
  return error instanceof Error ? error.name : String(error)
}

function onlineErrorData(error: unknown): Record<string, unknown> {
  if (error instanceof LLMProviderError) {
    return {
      category: error.category,
      status: error.status,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
    }
  }
  return { errorName: error instanceof Error ? error.name : typeof error }
}
