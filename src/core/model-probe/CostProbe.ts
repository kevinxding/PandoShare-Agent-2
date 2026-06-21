import type { ModelRouter } from '../model/ModelRouter.js'
import { createModelProbeResult, type ModelProbeFallbackStep, type ModelProbeResult } from './ModelProbeTypes.js'

export type FallbackProbeOutput = {
  result: ModelProbeResult
  fallbackChain: ModelProbeFallbackStep[]
}

export function runBudgetEstimateProbe(input: {
  router: ModelRouter
  sequence: number
  now: () => number
  totalTokens?: number
}): ModelProbeResult {
  const startedAtMs = input.now()
  const totalTokens = input.totalTokens ?? 3000
  try {
    const estimates = input.router.listModels().map(candidate => {
      const estimatedCost = input.router.estimateCost(candidate, totalTokens)
      return {
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        costClass: candidate.costClass,
        totalTokens,
        costKnown: estimatedCost !== undefined,
        estimatedCost: estimatedCost ?? null,
      }
    })
    const unknownCount = estimates.filter(estimate => !estimate.costKnown).length
    return createModelProbeResult(input.sequence, {
      type: 'budget_estimate',
      status: estimates.length ? 'passed' : 'failed',
      message: estimates.length
        ? `Estimated known costs for ${estimates.length - unknownCount} models; preserved ${unknownCount} unknown costs.`
        : 'No model candidates available for budget estimates.',
      startedAtMs,
      completedAtMs: input.now(),
      data: {
        totalTokens,
        unknownCostCount: unknownCount,
        estimates,
      },
    })
  } catch (error) {
    return createModelProbeResult(input.sequence, {
      type: 'budget_estimate',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      startedAtMs,
      completedAtMs: input.now(),
    })
  }
}

export function runFallbackSimulationProbe(input: {
  router: ModelRouter
  sequence: number
  now: () => number
}): FallbackProbeOutput {
  const startedAtMs = input.now()
  try {
    const decision = input.router.explainRoute({
      taskType: 'code',
      profileId: 'build',
      fallbackEnabled: true,
      contextTokensNeeded: 1000,
      estimatedOutputTokens: 500,
    })
    const fallbackChain: ModelProbeFallbackStep[] = []
    if (decision.selected) {
      fallbackChain.push({
        order: 0,
        providerId: decision.selected.providerId,
        modelId: decision.selected.modelId,
        role: 'selected',
        score: decision.selected.score,
        health: decision.selected.health.status,
      })
    }
    fallbackChain.push(...decision.fallbackPlan.candidates.map((candidate, index) => ({
      order: index + 1,
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      role: 'fallback' as const,
      score: candidate.score,
      health: candidate.health.status,
    })))
    return {
      fallbackChain,
      result: createModelProbeResult(input.sequence, {
        type: 'fallback_simulation',
        status: fallbackChain.length > 1 ? 'passed' : fallbackChain.length ? 'degraded' : 'failed',
        message: fallbackChain.length > 1
          ? `Fallback simulation produced ${fallbackChain.length} chain steps.`
          : 'Fallback simulation did not produce alternate fallback candidates.',
        startedAtMs,
        completedAtMs: input.now(),
        data: {
          routeStatus: decision.status,
          routeReason: decision.routeReason,
          fallbackReasons: decision.fallbackPlan.reasons,
          fallbackChain,
        },
      }),
    }
  } catch (error) {
    return {
      fallbackChain: [],
      result: createModelProbeResult(input.sequence, {
        type: 'fallback_simulation',
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        startedAtMs,
        completedAtMs: input.now(),
      }),
    }
  }
}
