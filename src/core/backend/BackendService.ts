import { resolve } from 'node:path'
import { createBackendAdapters, createBackendHandlers } from './adapters.js'
import { BackendRouter } from './BackendRouter.js'
import { toBackendErrorResponse } from './errors.js'
import { BackendTelemetry, mergeEventIds } from './telemetry.js'
import { isBackendAction, type BackendContext, type BackendRequest, type BackendResponse, type BackendServiceOptions, type NormalizedBackendRequest } from './types.js'

let requestCounter = 0

export class BackendService {
  private readonly context: BackendContext
  private readonly adapters
  private readonly router: BackendRouter
  private readonly telemetry: BackendTelemetry

  constructor(options: BackendServiceOptions) {
    this.context = {
      workspaceRoot: resolve(options.workspaceRoot),
      cwd: resolve(options.cwd ?? options.workspaceRoot),
      workspaceId: options.workspaceId ?? 'default',
      sessionId: options.sessionId ?? 'backend-' + Date.now(),
      source: options.source ?? 'daemon',
    }
    this.adapters = createBackendAdapters(options, this.context)
    this.router = new BackendRouter(createBackendHandlers())
    this.telemetry = new BackendTelemetry(this.adapters.durable)
  }

  async handle(input: BackendRequest): Promise<BackendResponse> {
    const request = normalizeRequest(input)
    const started = await this.telemetry.recordStarted(request, this.context)
    try {
      const output = await this.router.route(request, { context: this.context, adapters: this.adapters })
      const eventIds = mergeEventIds([started.eventId], output.eventIds)
      const completed = await this.telemetry.recordCompleted(request, this.context, eventIds)
      return { schemaVersion: 1, ok: true, requestId: request.requestId, action: request.action, createdAtMs: request.createdAtMs, completedAtMs: Date.now(), eventIds: mergeEventIds(eventIds, [completed.eventId]), telemetry: [started, completed], data: output.data }
    } catch (error) {
      const backendError = toBackendErrorResponse(error)
      const failed = await this.telemetry.recordFailed(request, this.context, backendError, [started.eventId])
      return { schemaVersion: 1, ok: false, requestId: request.requestId, action: request.action, createdAtMs: request.createdAtMs, completedAtMs: Date.now(), eventIds: [started.eventId, failed.eventId], telemetry: [started, failed], error: backendError }
    }
  }

  status(): BackendResponse {
    const now = Date.now()
    return { schemaVersion: 1, ok: true, requestId: 'status', action: 'system.health', createdAtMs: now, completedAtMs: now, eventIds: [], telemetry: [], data: { ok: true, context: this.context, supportedActions: Object.keys(createBackendHandlers()) } }
  }
}

function normalizeRequest(input: BackendRequest): NormalizedBackendRequest {
  const action = String(input.action)
  if (!isBackendAction(action)) throw new Error('Unsupported backend action: ' + action)
  requestCounter += 1
  return { schemaVersion: 1, requestId: input.requestId ?? 'backend_req_' + Date.now().toString(36) + '_' + requestCounter, action, payload: input.payload ?? {}, context: input.context ?? {}, createdAtMs: input.createdAtMs ?? Date.now() }
}
