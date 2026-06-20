import type {
  ModelCapabilitySet,
  ModelRouteCandidate,
  ModelRouteRequestV2,
  ModelTaskType,
} from './ModelTypes.js'

export function requiredCapabilitiesForTask(taskType: ModelTaskType): Partial<Record<keyof ModelCapabilitySet, boolean | number | string>> {
  switch (taskType) {
    case 'code':
    case 'repair':
    case 'test':
      return { tools: true, supportsSystemPrompt: true }
    case 'review':
    case 'plan':
      return { reasoning: true, supportsSystemPrompt: true }
    case 'gui':
      return { tools: true }
    case 'vision':
      return { vision: true, supportsImageInput: true }
    case 'loop':
      return { tools: true, reasoning: true }
    case 'verifier':
      return { reasoning: true }
    case 'gateway_reply':
    case 'summarizer':
      return { supportsSystemPrompt: true }
    case 'compactor':
    case 'long_context':
      return { longContext: true }
    case 'cheap':
      return {}
    case 'replay_audit':
      return { reasoning: true }
    case 'embedding_optional':
      return {}
  }
}

export function mergeRequiredCapabilities(request: ModelRouteRequestV2): Partial<Record<keyof ModelCapabilitySet, boolean | number | string>> {
  return {
    ...requiredCapabilitiesForTask(request.taskType),
    ...request.requiredCapabilities,
    ...request.requireCapabilities,
  }
}

export function missingCapabilities(
  candidate: ModelRouteCandidate,
  required: Partial<Record<keyof ModelCapabilitySet, boolean | number | string>>,
  contextTokensNeeded?: number,
): string[] {
  const missing: string[] = []
  for (const [key, expected] of Object.entries(required) as [keyof ModelCapabilitySet, boolean | number | string][]) {
    const actual = candidate.capabilities[key]
    if (typeof expected === 'boolean' && actual !== expected) missing.push(`${String(key)}=${String(expected)}`)
    if (typeof expected === 'number' && (typeof actual !== 'number' || actual < expected)) missing.push(`${String(key)}>=${expected}`)
    if (typeof expected === 'string' && actual !== expected) missing.push(`${String(key)}=${expected}`)
  }
  if (contextTokensNeeded !== undefined && contextTokensNeeded > candidate.capabilities.contextWindowTokens) {
    missing.push(`contextWindowTokens>=${contextTokensNeeded}`)
  }
  return missing
}

export function capabilityScore(candidate: ModelRouteCandidate, request: ModelRouteRequestV2): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  if (candidate.capabilities.reasoning) add(8, 'reasoning')
  if (candidate.capabilities.tools) add(8, 'tools')
  if (candidate.capabilities.vision) add(request.taskType === 'vision' || request.taskType === 'gui' ? 8 : 2, 'vision')
  if (candidate.capabilities.longContext) add(5, 'long_context')
  if (candidate.capabilities.streaming) add(2, 'streaming')
  if (request.contextTokensNeeded && candidate.capabilities.contextWindowTokens >= request.contextTokensNeeded * 2) add(4, 'context_headroom')
  return { score, reasons }

  function add(weight: number, reason: string): void {
    score += weight
    reasons.push(reason)
  }
}