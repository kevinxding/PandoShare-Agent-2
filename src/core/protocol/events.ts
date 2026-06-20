import type { AgentEvent } from '../../services/events/index.js'
import { createProtocolId } from './commands.js'

export type KernelEventType =
  | 'run_created'
  | 'run_start'
  | 'run_running'
  | 'run_complete'
  | 'run_failed'
  | 'run_interrupted'
  | 'tool_call'
  | 'approval'
  | 'model_request'
  | 'model_response'
  | 'gui_action'
  | 'gateway_message'
  | 'loop_iteration'
  | 'checkpoint'
  | 'heartbeat'
  | string

export type EventEnvelope<TPayload = unknown> = {
  schemaVersion: 1
  eventId: string
  seq: number
  eventType: KernelEventType
  workspaceId: string
  threadId?: string
  runId?: string
  goalId?: string
  loopId?: string
  taskId?: string
  toolCallId?: string
  parentEventId?: string
  createdAtMs: number
  payload: TPayload
}

export type EventEnvelopeInput<TPayload = unknown> = {
  eventType: KernelEventType
  workspaceId: string
  payload: TPayload
  threadId?: string
  runId?: string
  goalId?: string
  loopId?: string
  taskId?: string
  toolCallId?: string
  parentEventId?: string
  eventId?: string
  seq?: number
  createdAtMs?: number
}

export type EventSequencer = {
  next(workspaceId: string): number
}

export type EventEnvelopeSink = (event: EventEnvelope) => void | Promise<void>

export function createInMemoryEventSequencer(initialSeq = 0): EventSequencer {
  const seqByWorkspace = new Map<string, number>()
  return {
    next(workspaceId) {
      const nextSeq = (seqByWorkspace.get(workspaceId) ?? initialSeq) + 1
      seqByWorkspace.set(workspaceId, nextSeq)
      return nextSeq
    },
  }
}

export function createEventEnvelope<TPayload = unknown>(
  input: EventEnvelopeInput<TPayload>,
  sequencer = defaultSequencer,
): EventEnvelope<TPayload> {
  const envelope = {
    schemaVersion: 1,
    eventId: input.eventId ?? createProtocolId('evt'),
    seq: input.seq ?? sequencer.next(input.workspaceId),
    eventType: input.eventType,
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    runId: input.runId,
    goalId: input.goalId,
    loopId: input.loopId,
    taskId: input.taskId,
    toolCallId: input.toolCallId,
    parentEventId: input.parentEventId,
    createdAtMs: input.createdAtMs ?? Date.now(),
    payload: input.payload,
  } satisfies EventEnvelope<TPayload>
  validateEventEnvelope(envelope)
  return envelope
}

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  try {
    validateEventEnvelope(value)
    return true
  } catch {
    return false
  }
}

export function validateEventEnvelope(value: unknown): asserts value is EventEnvelope {
  assertRecord(value, 'EventEnvelope')
  if (value.schemaVersion !== 1) throw new Error('EventEnvelope.schemaVersion must be 1')
  assertNonEmptyString(value.eventId, 'EventEnvelope.eventId')
  if (typeof value.seq !== 'number' || !Number.isInteger(value.seq) || value.seq < 1) {
    throw new Error('EventEnvelope.seq must be a positive integer')
  }
  assertNonEmptyString(value.eventType, 'EventEnvelope.eventType')
  assertNonEmptyString(value.workspaceId, 'EventEnvelope.workspaceId')
  assertOptionalAsciiId(value.threadId, 'EventEnvelope.threadId')
  assertOptionalAsciiId(value.runId, 'EventEnvelope.runId')
  assertOptionalAsciiId(value.goalId, 'EventEnvelope.goalId')
  assertOptionalAsciiId(value.loopId, 'EventEnvelope.loopId')
  assertOptionalAsciiId(value.taskId, 'EventEnvelope.taskId')
  assertOptionalAsciiId(value.toolCallId, 'EventEnvelope.toolCallId')
  assertOptionalAsciiId(value.parentEventId, 'EventEnvelope.parentEventId')
  if (typeof value.createdAtMs !== 'number' || !Number.isFinite(value.createdAtMs) || value.createdAtMs < 0) {
    throw new Error('EventEnvelope.createdAtMs must be a finite timestamp')
  }
  if (!('payload' in value)) throw new Error('EventEnvelope.payload is required')
}

export function agentEventToEnvelope(
  event: AgentEvent,
  input: {
    workspaceId: string
    threadId?: string
    runId?: string
    goalId?: string
    loopId?: string
    seq?: number
    sequencer?: EventSequencer
  },
): EventEnvelope<AgentEvent & { legacyRunId?: string }> {
  const legacyRunId = eventRunId(event)
  return createEventEnvelope(
    {
      eventId: event.id,
      seq: input.seq,
      eventType: legacyEventType(event.type),
      workspaceId: input.workspaceId,
      threadId: input.threadId ?? eventThreadId(event),
      runId: input.runId ?? legacyRunId,
      goalId: input.goalId ?? event.goalId,
      loopId: input.loopId ?? eventLoopId(event),
      taskId: eventTaskId(event),
      toolCallId: eventToolCallId(event),
      createdAtMs: event.createdAtMs,
      payload: legacyRunId ? { ...event, legacyRunId } : event,
    },
    input.sequencer,
  )
}

function legacyEventType(type: string): KernelEventType {
  if (type === 'run_started') return 'run_start'
  if (type === 'run_completed') return 'run_complete'
  if (type === 'run_failed') return 'run_failed'
  if (type.startsWith('tool_')) return 'tool_call'
  if (type.startsWith('approval_')) return 'approval'
  if (type === 'model_request_started') return 'model_request'
  if (type === 'model_response_completed') return 'model_response'
  if (type.startsWith('gui_action_')) return 'gui_action'
  if (type.startsWith('compaction_')) return 'checkpoint'
  return type
}

function eventThreadId(event: AgentEvent): string | undefined {
  return 'threadId' in event && typeof event.threadId === 'string' ? event.threadId : undefined
}

function eventRunId(event: AgentEvent): string | undefined {
  return 'runId' in event && typeof event.runId === 'string' ? event.runId : undefined
}

function eventLoopId(event: AgentEvent): string | undefined {
  return 'loopId' in event && typeof event.loopId === 'string' ? event.loopId : undefined
}

function eventTaskId(event: AgentEvent): string | undefined {
  return 'taskId' in event && typeof event.taskId === 'string' ? event.taskId : undefined
}

function eventToolCallId(event: AgentEvent): string | undefined {
  if ('toolUseId' in event && typeof event.toolUseId === 'string') return event.toolUseId
  return undefined
}

function assertRecord(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`)
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`)
}

function assertOptionalAsciiId(value: unknown, name: string): void {
  if (value === undefined) return
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${name} must be an ASCII id`)
  }
}

const defaultSequencer = createInMemoryEventSequencer()
