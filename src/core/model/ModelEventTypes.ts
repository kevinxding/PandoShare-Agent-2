export const MODEL_EVENT_TYPES = {
  catalogLoaded: 'model_catalog_loaded',
  providerRegistered: 'model_provider_registered',
  providerConfigured: 'model_provider_configured',
  providerMissingAuth: 'model_provider_missing_auth',
  providerHealthChanged: 'model_provider_health_changed',
  routeRequested: 'model_route_requested',
  routeSelected: 'model_route_selected',
  routeRejected: 'model_route_rejected',
  fallbackPlanned: 'model_fallback_planned',
  fallbackSelected: 'model_fallback_selected',
  fallbackExhausted: 'model_fallback_exhausted',
  requestStarted: 'model_request_started',
  responseCompleted: 'model_response_completed',
  requestFailed: 'model_request_failed',
  rateLimited: 'model_rate_limited',
  budgetWarning: 'model_budget_warning',
  budgetExceeded: 'model_budget_exceeded',
  usageRecorded: 'model_usage_recorded',
  profileSelected: 'model_profile_selected',
  profileUpdated: 'model_profile_updated',
  gatewaySwitchRequested: 'model_gateway_switch_requested',
  gatewaySwitchApplied: 'model_gateway_switch_applied',
  legacyEventBridged: 'model_legacy_event_bridged',
} as const

export type ModelEventType = typeof MODEL_EVENT_TYPES[keyof typeof MODEL_EVENT_TYPES]

export function isModelEventType(value: string): value is ModelEventType {
  return Object.values(MODEL_EVENT_TYPES).includes(value as ModelEventType)
}
