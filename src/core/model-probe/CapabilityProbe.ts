import type { ModelRouter } from '../model/ModelRouter.js'
import { createModelProbeResult, type ModelProbeModelSummary, type ModelProbeProfileSummary, type ModelProbeResult } from './ModelProbeTypes.js'

export function summarizeModelProbeModels(router: ModelRouter): ModelProbeModelSummary[] {
  return router.listModels().map(candidate => ({
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    tools: candidate.capabilities.tools,
    vision: candidate.capabilities.vision,
    streaming: candidate.capabilities.streaming,
    reasoning: candidate.capabilities.reasoning,
    longContext: candidate.capabilities.longContext,
    contextWindowTokens: candidate.capabilities.contextWindowTokens,
    costClass: candidate.costClass,
    latencyClass: candidate.capabilities.latencyClass,
    privacyClass: candidate.privacyClass,
    region: candidate.capabilities.region,
  }))
}

export function summarizeModelProbeProfiles(router: ModelRouter): ModelProbeProfileSummary[] {
  return router.listProfiles().map(profile => ({
    profileId: profile.profileId,
    taskType: profile.taskType,
    fallbackEnabled: profile.policy.fallbackEnabled ?? true,
  }))
}

export function runCatalogShapeProbe(input: {
  router: ModelRouter
  sequence: number
  now: () => number
}): ModelProbeResult {
  const startedAtMs = input.now()
  try {
    const providers = input.router.listProviders()
    const models = summarizeModelProbeModels(input.router)
    const profiles = summarizeModelProbeProfiles(input.router)
    const invalidModels = models.filter(model => !model.providerId || !model.modelId || model.contextWindowTokens <= 0)
    const failed = providers.length === 0 || models.length === 0 || profiles.length === 0 || invalidModels.length > 0
    return createModelProbeResult(input.sequence, {
      type: 'catalog_shape',
      status: failed ? 'failed' : 'passed',
      message: failed
        ? 'Catalog shape is incomplete or contains invalid model records.'
        : `Catalog shape includes ${providers.length} providers, ${models.length} models, and ${profiles.length} profiles.`,
      startedAtMs,
      completedAtMs: input.now(),
      data: {
        providerCount: providers.length,
        modelCount: models.length,
        profileCount: profiles.length,
        invalidModelCount: invalidModels.length,
      },
    })
  } catch (error) {
    return createModelProbeResult(input.sequence, {
      type: 'catalog_shape',
      status: 'failed',
      message: safeErrorMessage(error),
      startedAtMs,
      completedAtMs: input.now(),
    })
  }
}

export function runCapabilityStaticProbe(input: {
  router: ModelRouter
  sequence: number
  now: () => number
}): ModelProbeResult {
  const startedAtMs = input.now()
  try {
    const models = summarizeModelProbeModels(input.router)
    const profiles = summarizeModelProbeProfiles(input.router)
    const capabilityCoverage = {
      tools: models.filter(model => model.tools).length,
      vision: models.filter(model => model.vision).length,
      streaming: models.filter(model => model.streaming).length,
      reasoning: models.filter(model => model.reasoning).length,
      longContext: models.filter(model => model.longContext).length,
    }
    return createModelProbeResult(input.sequence, {
      type: 'capability_static',
      status: models.length && profiles.length ? 'passed' : 'failed',
      message: models.length && profiles.length
        ? 'Static capability matrix is available from router public methods.'
        : 'Static capability matrix is missing models or profiles.',
      startedAtMs,
      completedAtMs: input.now(),
      data: {
        capabilityCoverage,
        models,
        profiles,
      },
    })
  } catch (error) {
    return createModelProbeResult(input.sequence, {
      type: 'capability_static',
      status: 'failed',
      message: safeErrorMessage(error),
      startedAtMs,
      completedAtMs: input.now(),
    })
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
