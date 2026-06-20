import type { ModelCostClass, ModelPrivacyClass, ModelRouteCandidate, ModelRoutingPolicy } from './ModelTypes.js'

const COST_ORDER: ModelCostClass[] = ['free', 'cheap', 'standard', 'expensive', 'unknown']
const PRIVACY_ORDER: ModelPrivacyClass[] = ['local', 'first_party', 'third_party', 'custom']

export function costAllowed(candidate: ModelRouteCandidate, maxCostClass: ModelCostClass | undefined): boolean {
  if (!maxCostClass || maxCostClass === 'unknown') return true
  const candidateIndex = COST_ORDER.indexOf(candidate.costClass)
  const maxIndex = COST_ORDER.indexOf(maxCostClass)
  if (candidateIndex === -1 || maxIndex === -1) return true
  return candidateIndex <= maxIndex
}

export function privacyAllowed(candidate: ModelRouteCandidate, requirement: ModelPrivacyClass | undefined): boolean {
  if (!requirement) return true
  const candidateIndex = PRIVACY_ORDER.indexOf(candidate.privacyClass)
  const requiredIndex = PRIVACY_ORDER.indexOf(requirement)
  if (candidateIndex === -1 || requiredIndex === -1) return candidate.privacyClass === requirement
  return candidateIndex <= requiredIndex
}

export function providerAllowed(candidate: ModelRouteCandidate, policy: ModelRoutingPolicy): string | undefined {
  if (policy.allowedProviders?.length && !policy.allowedProviders.includes(candidate.providerId)) return 'provider_not_allowed'
  if (policy.deniedProviders?.includes(candidate.providerId)) return 'provider_denied'
  if (policy.allowedModels?.length && !policy.allowedModels.includes(candidate.modelId)) return 'model_not_allowed'
  if (policy.deniedModels?.includes(candidate.modelId)) return 'model_denied'
  if (!costAllowed(candidate, policy.maxCostClass)) return 'cost_class_too_high'
  if (!privacyAllowed(candidate, policy.privacyRequirement)) return 'privacy_requirement_not_met'
  return undefined
}

export function costScore(costClass: ModelCostClass): number {
  switch (costClass) {
    case 'free': return 14
    case 'cheap': return 10
    case 'standard': return 4
    case 'expensive': return -3
    case 'unknown': return 0
  }
}