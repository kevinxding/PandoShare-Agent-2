import type { ModelRouter } from '../model/ModelRouter.js'
import type { ModelProviderRecord } from '../model/ModelTypes.js'
import { createModelProbeResult, type ModelProbeProviderSummary, type ModelProbeResult } from './ModelProbeTypes.js'

export function summarizeModelProbeProviders(router: ModelRouter): ModelProbeProviderSummary[] {
  return router.listProviders().map(provider => ({
    providerId: provider.providerId,
    displayName: provider.displayName,
    configured: provider.configured,
    authState: authState(provider),
    missingAuth: provider.missingAuth,
    region: provider.region,
    privacyClass: provider.privacyClass,
    costClass: provider.costClass,
    latencyClass: provider.latencyClass,
  }))
}

export function runConfigProbe(input: {
  router: ModelRouter
  sequence: number
  now: () => number
}): ModelProbeResult {
  const startedAtMs = input.now()
  try {
    const providers = summarizeModelProbeProviders(input.router)
    return createModelProbeResult(input.sequence, {
      type: 'config',
      status: providers.length ? 'passed' : 'failed',
      message: providers.length
        ? `Resolved ${providers.length} model providers from built-in and configured catalog.`
        : 'No model providers resolved from catalog.',
      startedAtMs,
      completedAtMs: input.now(),
      data: {
        providerCount: providers.length,
        configuredCount: providers.filter(provider => provider.configured).length,
      },
    })
  } catch (error) {
    return createModelProbeResult(input.sequence, {
      type: 'config',
      status: 'failed',
      message: safeErrorMessage(error),
      startedAtMs,
      completedAtMs: input.now(),
    })
  }
}

export function runAuthPresenceProbe(input: {
  router: ModelRouter
  sequence: number
  now: () => number
}): ModelProbeResult {
  const startedAtMs = input.now()
  try {
    const providers = summarizeModelProbeProviders(input.router)
    const missing = providers.filter(provider => provider.missingAuth)
    return createModelProbeResult(input.sequence, {
      type: 'auth_presence',
      status: missing.length ? 'missing_auth' : 'passed',
      message: missing.length
        ? `${missing.length} providers are missing auth; offline probes continue.`
        : 'All providers with auth requirements have auth presence.',
      startedAtMs,
      completedAtMs: input.now(),
      data: {
        providerCount: providers.length,
        missingAuthCount: missing.length,
        providers: providers.map(provider => ({
          providerId: provider.providerId,
          configured: provider.configured,
          authState: provider.authState,
          missingAuth: provider.missingAuth,
        })),
      },
    })
  } catch (error) {
    return createModelProbeResult(input.sequence, {
      type: 'auth_presence',
      status: 'failed',
      message: safeErrorMessage(error),
      startedAtMs,
      completedAtMs: input.now(),
    })
  }
}

function authState(provider: ModelProviderRecord): ModelProbeProviderSummary['authState'] {
  if (provider.missingAuth) return 'missing_auth'
  if (provider.configured) return 'configured'
  return 'none'
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
