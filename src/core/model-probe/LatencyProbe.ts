import type { ModelRouter } from '../model/ModelRouter.js'
import { createModelProbeResult, type ModelProbeResult } from './ModelProbeTypes.js'

export function runLatencyMockProbe(input: {
  router: ModelRouter
  sequence: number
  now: () => number
}): ModelProbeResult {
  const startedAtMs = input.now()
  try {
    const samples = input.router.listModels().map(candidate => ({
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      mockLatencyMs: deterministicLatencyMs(candidate.providerId, candidate.modelId),
    }))
    const latencies = samples.map(sample => sample.mockLatencyMs).sort((left, right) => left - right)
    return createModelProbeResult(input.sequence, {
      type: 'latency_mock',
      status: samples.length ? 'passed' : 'failed',
      message: samples.length
        ? 'Deterministic mock latency samples generated without network calls.'
        : 'No model candidates available for mock latency samples.',
      startedAtMs,
      completedAtMs: input.now(),
      data: {
        deterministic: true,
        sampleCount: samples.length,
        p50Ms: percentile(latencies, 0.5),
        p95Ms: percentile(latencies, 0.95),
        samples,
      },
    })
  } catch (error) {
    return createModelProbeResult(input.sequence, {
      type: 'latency_mock',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      startedAtMs,
      completedAtMs: input.now(),
    })
  }
}

function deterministicLatencyMs(providerId: string, modelId: string): number {
  const value = `${providerId}:${modelId}`
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 997
  }
  return 40 + (hash % 120)
}

function percentile(values: readonly number[], ratio: number): number | undefined {
  if (!values.length) return undefined
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))
  return values[index]
}
