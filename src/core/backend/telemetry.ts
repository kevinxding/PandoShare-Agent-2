import type { DurableRuntime } from '../durable/index.js'
import type { BackendAction, BackendContext, BackendErrorResponse, BackendTelemetryRecord, NormalizedBackendRequest } from './types.js'

export class BackendTelemetry {
  constructor(private readonly durable: DurableRuntime) {}

  recordStarted(request: NormalizedBackendRequest, context: BackendContext): Promise<BackendTelemetryRecord> {
    return this.record('started', 'backend_request_started', request, context)
  }

  recordCompleted(
    request: NormalizedBackendRequest,
    context: BackendContext,
    eventIds: readonly string[],
  ): Promise<BackendTelemetryRecord> {
    return this.record('completed', 'backend_request_completed', request, context, { eventIds })
  }

  recordFailed(
    request: NormalizedBackendRequest,
    context: BackendContext,
    error: BackendErrorResponse,
    eventIds: readonly string[],
  ): Promise<BackendTelemetryRecord> {
    return this.record('failed', 'backend_request_failed', request, context, { error, eventIds })
  }

  private async record(
    stage: BackendTelemetryRecord['stage'],
    eventType: string,
    request: NormalizedBackendRequest,
    context: BackendContext,
    extra: Record<string, unknown> = {},
  ): Promise<BackendTelemetryRecord> {
    const event = await this.durable.appendEvent({
      eventType,
      workspaceId: context.workspaceId,
      threadId: context.threadId,
      runId: context.runId,
      goalId: context.goalId,
      loopId: context.loopId,
      payload: {
        requestId: request.requestId,
        action: request.action,
        source: context.source,
        sessionId: context.sessionId,
        ...extra,
      },
    })
    return {
      stage,
      eventId: event.eventId,
      eventType,
      createdAtMs: event.createdAtMs,
    }
  }
}

export function collectEventIds(value: unknown): string[] {
  const out = new Set<string>()
  collect(value, out, 0)
  return Array.from(out)
}

export function mergeEventIds(...groups: readonly (readonly string[] | undefined)[]): string[] {
  const out = new Set<string>()
  for (const group of groups) {
    for (const eventId of group ?? []) {
      if (eventId) out.add(eventId)
    }
  }
  return Array.from(out)
}

function collect(value: unknown, out: Set<string>, depth: number): void {
  if (depth > 4 || value === undefined || value === null) return
  if (typeof value === 'string') return
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (typeof record.eventId === 'string') out.add(record.eventId)
  if (Array.isArray(record.eventIds)) {
    for (const eventId of record.eventIds) {
      if (typeof eventId === 'string') out.add(eventId)
    }
  }
  for (const key of ['coreEvents', 'events', 'data']) {
    collect(record[key], out, depth + 1)
  }
}

export function actionKernel(action: BackendAction): string {
  return action.slice(0, action.indexOf('.'))
}
