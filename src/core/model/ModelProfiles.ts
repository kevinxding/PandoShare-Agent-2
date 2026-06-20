import type { ModelProfile, ModelProfileId, ModelRoutingPolicy, ModelTaskType } from './ModelTypes.js'

const PROFILES: ModelProfile[] = [
  profile('build', 'code', 'Coding and harness work', { preferredCapabilities: { tools: true, reasoning: true }, fallbackEnabled: true }),
  profile('plan', 'plan', 'Planning and decomposition', { preferredCapabilities: { reasoning: true }, fallbackEnabled: true }),
  profile('gui', 'gui', 'GUI automation planning and action selection', { preferredCapabilities: { tools: true, vision: true }, fallbackEnabled: true }),
  profile('loop', 'loop', 'Long-running loop supervisor work', { preferredCapabilities: { tools: true, reasoning: true, longContext: true }, fallbackEnabled: true }),
  profile('verifier', 'verifier', 'Independent verification and review', { preferredCapabilities: { reasoning: true }, sameFamilyAvoidanceForVerifier: true, fallbackEnabled: true }),
  profile('repair', 'repair', 'Focused repair attempts', { preferredCapabilities: { tools: true, reasoning: true }, fallbackEnabled: true }),
  profile('gateway', 'gateway_reply', 'Short gateway replies', { preferredCapabilities: { streaming: true }, fallbackEnabled: true }),
  profile('compact', 'compactor', 'Context compaction and summaries', { preferredCapabilities: { longContext: true, reasoning: true }, fallbackEnabled: true }),
  profile('replay', 'replay_audit', 'Replay and audit reasoning', { preferredCapabilities: { reasoning: true, longContext: true }, fallbackEnabled: true }),
  profile('cheap', 'cheap', 'Low-cost background work', { maxCostClass: 'cheap', fallbackEnabled: true }),
]

export function listModelProfiles(): ModelProfile[] {
  return PROFILES.map(item => ({ ...item, policy: { ...item.policy } }))
}

export function getModelProfile(profileId: ModelProfileId | undefined): ModelProfile | undefined {
  if (!profileId) return undefined
  return listModelProfiles().find(profile => profile.profileId === profileId)
}

export function profileForTask(taskType: ModelTaskType): ModelProfile | undefined {
  return listModelProfiles().find(profile => profile.taskType === taskType)
}

export function mergeProfilePolicy(profile: ModelProfile | undefined, request: ModelRoutingPolicy): ModelRoutingPolicy {
  return {
    ...profile?.policy,
    ...request,
    requiredCapabilities: {
      ...profile?.policy.requiredCapabilities,
      ...request.requiredCapabilities,
    },
    preferredCapabilities: {
      ...profile?.policy.preferredCapabilities,
      ...request.preferredCapabilities,
    },
    budgetPolicy: {
      ...profile?.policy.budgetPolicy,
      ...request.budgetPolicy,
    },
    healthPolicy: {
      ...profile?.policy.healthPolicy,
      ...request.healthPolicy,
    },
  }
}

function profile(profileId: ModelProfileId, taskType: ModelTaskType, description: string, policy: ModelRoutingPolicy): ModelProfile {
  return { profileId, taskType, description, policy }
}