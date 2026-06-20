import type { AuthConfig, ProviderDefinition } from '../../services/llm/types.js'
import type {
  ModelCapabilitySet,
  ModelCostClass,
  ModelLatencyClass,
  ModelPrivacyClass,
  ModelProviderRecord,
  ModelRegion,
  ModelRouteCandidate,
} from './ModelTypes.js'
import type { ModelHealth } from './ModelHealth.js'
import type { ProviderRegistry } from './ProviderRegistry.js'

export class ModelCatalog {
  constructor(private readonly registry: ProviderRegistry, private readonly health: ModelHealth) {}

  listProviders(): ModelProviderRecord[] {
    return this.registry.listProviders().map(provider => providerRecord(provider))
  }

  listCandidates(): ModelRouteCandidate[] {
    return this.listProviders().map(record => {
      const modelId = record.provider.defaultModel
      const health = this.health.get(record.providerId, modelId)
      return {
        providerId: record.providerId,
        modelId,
        provider: record.provider,
        displayName: record.displayName,
        capabilities: capabilitySet(record.provider, record),
        health,
        configured: record.configured,
        missingAuth: record.missingAuth,
        costClass: record.costClass,
        region: record.region,
        privacyClass: record.privacyClass,
        score: 0,
        scoreReasons: [],
      }
    })
  }
}

export function providerRecord(provider: ProviderDefinition): ModelProviderRecord {
  const metadata = providerMetadata(provider.id)
  const auth = missingAuth(provider.auth)
  return {
    providerId: provider.id,
    displayName: provider.name,
    provider,
    configured: true,
    missingAuth: auth.missing,
    missingAuthEnv: auth.envKeys,
    region: metadata.region,
    privacyClass: metadata.privacyClass,
    costClass: metadata.costClass,
    latencyClass: metadata.latencyClass,
  }
}

export function capabilitySet(provider: ProviderDefinition, record = providerRecord(provider)): ModelCapabilitySet {
  return {
    tools: provider.capabilities.tools,
    vision: provider.capabilities.vision,
    streaming: provider.capabilities.streaming,
    reasoning: provider.capabilities.reasoning,
    jsonMode: true,
    longContext: provider.capabilities.contextWindowTokens >= 64_000,
    contextWindowTokens: provider.capabilities.contextWindowTokens,
    functionCallingStyle: provider.capabilities.tools ? 'openai_tools' : 'none',
    supportsSystemPrompt: true,
    supportsImageInput: provider.capabilities.vision,
    supportsToolChoice: provider.capabilities.tools,
    supportsParallelTools: provider.capabilities.tools,
    supportsStreamingTools: provider.capabilities.streaming && provider.capabilities.tools,
    local: record.privacyClass === 'local',
    region: record.region,
    privacyClass: record.privacyClass,
    latencyClass: record.latencyClass,
    costClass: record.costClass,
  }
}

function providerMetadata(providerId: string): {
  region: ModelRegion
  privacyClass: ModelPrivacyClass
  costClass: ModelCostClass
  latencyClass: ModelLatencyClass
} {
  switch (providerId) {
    case 'openai':
    case 'openai-codex':
      return { region: 'global', privacyClass: 'first_party', costClass: 'expensive', latencyClass: 'medium' }
    case 'deepseek':
      return { region: 'cn', privacyClass: 'third_party', costClass: 'cheap', latencyClass: 'medium' }
    case 'minimax-cn':
      return { region: 'cn', privacyClass: 'third_party', costClass: 'standard', latencyClass: 'medium' }
    default: {
      const lowered = providerId.toLowerCase()
      if (lowered.includes('local')) return { region: 'local', privacyClass: 'local', costClass: 'free', latencyClass: 'low' }
      if (lowered.includes('free')) return { region: 'custom', privacyClass: 'custom', costClass: 'free', latencyClass: 'unknown' }
      if (lowered.includes('cheap')) return { region: 'custom', privacyClass: 'custom', costClass: 'cheap', latencyClass: 'unknown' }
      return { region: 'custom', privacyClass: 'custom', costClass: 'unknown', latencyClass: 'unknown' }
    }
  }
}

function missingAuth(auth: AuthConfig): { missing: boolean; envKeys?: readonly string[] } {
  if (auth.type === 'none') return { missing: false }
  if (auth.token) return { missing: false }
  const envKeys = auth.envKeys
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  const hasEnv = envKeys.some(key => Boolean(env[key]))
  return hasEnv ? { missing: false } : { missing: true, envKeys }
}