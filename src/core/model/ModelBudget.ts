import type { ModelBudgetDecision, ModelBudgetPolicy, ModelRouteCandidate, ModelRouteRequestV2, ModelUsageRecordV2 } from './ModelTypes.js'

export class ModelBudget {
  decide(input: {
    request: ModelRouteRequestV2
    candidate?: ModelRouteCandidate
    usage?: readonly ModelUsageRecordV2[]
  }): ModelBudgetDecision {
    const policy = input.request.budgetPolicy
    const inputTokens = input.request.contextTokensNeeded ?? estimateTokensFromChars(input.request.taskType.length)
    const outputTokens = input.request.estimatedOutputTokens ?? policy?.maxOutputTokens ?? 2048
    const totalTokens = inputTokens + outputTokens
    const estimatedCost = estimateCost(input.candidate, totalTokens)
    if (!policy) {
      return { status: 'ok', reason: 'no_budget_policy', estimatedInputTokens: inputTokens, estimatedOutputTokens: outputTokens, estimatedTotalTokens: totalTokens, estimatedCost }
    }
    const exceeded = exceeds(policy, inputTokens, outputTokens, totalTokens, estimatedCost)
    if (exceeded) {
      return { status: policy.hardLimit === false ? 'warning' : 'exceeded', reason: exceeded, estimatedInputTokens: inputTokens, estimatedOutputTokens: outputTokens, estimatedTotalTokens: totalTokens, estimatedCost, warnAtRatio: policy.warnAtRatio, hardLimit: policy.hardLimit ?? true }
    }
    const warning = warns(policy, inputTokens, outputTokens, totalTokens, estimatedCost)
    if (warning) {
      return { status: 'warning', reason: warning, estimatedInputTokens: inputTokens, estimatedOutputTokens: outputTokens, estimatedTotalTokens: totalTokens, estimatedCost, warnAtRatio: policy.warnAtRatio, hardLimit: policy.hardLimit }
    }
    return { status: 'ok', reason: 'within_budget', estimatedInputTokens: inputTokens, estimatedOutputTokens: outputTokens, estimatedTotalTokens: totalTokens, estimatedCost, warnAtRatio: policy.warnAtRatio, hardLimit: policy.hardLimit }
  }
}

export function estimateCost(candidate: ModelRouteCandidate | undefined, totalTokens: number): number | undefined {
  if (!candidate) return undefined
  const perMillion = candidate.costClass === 'free' ? 0 : candidate.costClass === 'cheap' ? 0.3 : candidate.costClass === 'standard' ? 2 : candidate.costClass === 'expensive' ? 10 : undefined
  return perMillion === undefined ? undefined : (totalTokens / 1_000_000) * perMillion
}

function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4))
}

function exceeds(policy: ModelBudgetPolicy, inputTokens: number, outputTokens: number, totalTokens: number, estimatedCost: number | undefined): string | undefined {
  if (policy.maxInputTokens !== undefined && inputTokens > policy.maxInputTokens) return 'max_input_tokens_exceeded'
  if (policy.maxOutputTokens !== undefined && outputTokens > policy.maxOutputTokens) return 'max_output_tokens_exceeded'
  if (policy.maxTotalTokens !== undefined && totalTokens > policy.maxTotalTokens) return 'max_total_tokens_exceeded'
  if (policy.maxEstimatedCost !== undefined && estimatedCost !== undefined && estimatedCost > policy.maxEstimatedCost) return 'max_estimated_cost_exceeded'
  return undefined
}

function warns(policy: ModelBudgetPolicy, inputTokens: number, outputTokens: number, totalTokens: number, estimatedCost: number | undefined): string | undefined {
  const ratio = policy.warnAtRatio
  if (ratio === undefined) return undefined
  if (policy.maxInputTokens !== undefined && inputTokens >= policy.maxInputTokens * ratio) return 'max_input_tokens_warning'
  if (policy.maxOutputTokens !== undefined && outputTokens >= policy.maxOutputTokens * ratio) return 'max_output_tokens_warning'
  if (policy.maxTotalTokens !== undefined && totalTokens >= policy.maxTotalTokens * ratio) return 'max_total_tokens_warning'
  if (policy.maxEstimatedCost !== undefined && estimatedCost !== undefined && estimatedCost >= policy.maxEstimatedCost * ratio) return 'max_estimated_cost_warning'
  return undefined
}