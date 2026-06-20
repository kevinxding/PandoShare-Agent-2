import type { ModelFallbackPlan, ModelRouteCandidate, ModelRouteRequestV2 } from './ModelTypes.js'

export class FallbackPlanner {
  plan(input: {
    request: ModelRouteRequestV2
    selected?: ModelRouteCandidate
    rankedCandidates: readonly ModelRouteCandidate[]
    rejectedReasons: readonly string[]
  }): ModelFallbackPlan {
    const enabled = input.request.fallbackEnabled ?? true
    if (!enabled) return { enabled: false, maxFallbacks: 0, candidates: [], reasons: ['fallback_disabled'] }
    const maxFallbacks = 2
    const candidates = input.rankedCandidates
      .filter(candidate => !input.selected || candidate.providerId !== input.selected.providerId || candidate.modelId !== input.selected.modelId)
      .slice(0, maxFallbacks)
    return {
      enabled,
      maxFallbacks,
      candidates,
      reasons: candidates.length ? ['fallback_candidates_available'] : [...input.rejectedReasons, 'no_fallback_candidates'].slice(0, 5),
    }
  }
}