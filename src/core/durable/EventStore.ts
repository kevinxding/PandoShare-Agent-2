import {
  createEventEnvelope,
  createProtocolId,
  validateEventEnvelope,
  type EventEnvelope,
  type EventEnvelopeInput,
} from '../protocol/index.js'
import { JsonlStore, ProcessFileLock, RuntimePaths, type JsonlReadResult } from '../store/index.js'
import { redactDurablePayload } from './DurableRedaction.js'
import { EventSeq } from './EventSeq.js'

export type DurableEventInput<TPayload = unknown> = Omit<EventEnvelopeInput<TPayload>, 'seq'> & {
  seq?: never
}

export type EventStoreAppendOptions = {
  importMode?: boolean
}

export class EventStore {
  private readonly store: JsonlStore<EventEnvelope>
  private readonly appendLock: ProcessFileLock
  private readonly seq: EventSeq

  constructor(private readonly paths: RuntimePaths) {
    this.store = new JsonlStore<EventEnvelope>(paths.eventsPath())
    this.appendLock = new ProcessFileLock(paths.eventsPath())
    this.seq = new EventSeq(paths)
  }

  async append(input: DurableEventInput | EventEnvelope, options: EventStoreAppendOptions = {}): Promise<EventEnvelope> {
    if ('seq' in input && input.seq !== undefined && !options.importMode) {
      throw new Error('Durable EventStore rejects pre-sequenced events outside import mode')
    }
    return this.appendLock.withLock({ reason: `event append ${this.paths.workspaceId}` }, async () => {
      const event = options.importMode && 'seq' in input && input.seq !== undefined
        ? this.importEvent(input as EventEnvelope)
        : await this.createDurableEventInTransaction(input as DurableEventInput)
      validateEventForStore(event)
      await this.store.append(event)
      return event
    })
  }

  async appendMany(inputs: readonly (DurableEventInput | EventEnvelope)[], options: EventStoreAppendOptions = {}): Promise<EventEnvelope[]> {
    const written: EventEnvelope[] = []
    for (const input of inputs) {
      written.push(await this.append(input, options))
    }
    return written
  }

  async readEvents(input: { threadId?: string; runId?: string; loopId?: string } = {}): Promise<EventEnvelope[]> {
    return (await this.store.readRecords())
      .filter(event => input.threadId === undefined || event.threadId === input.threadId)
      .filter(event => input.runId === undefined || event.runId === input.runId)
      .filter(event => input.loopId === undefined || event.loopId === input.loopId)
      .sort((left, right) => left.seq - right.seq)
  }

  async readWithCorruption(): Promise<JsonlReadResult<EventEnvelope>> {
    return this.store.readWithCorruption()
  }

  readRunEvents(runId: string): Promise<EventEnvelope[]> {
    return this.readEvents({ runId })
  }

  readThreadEvents(threadId: string): Promise<EventEnvelope[]> {
    return this.readEvents({ threadId })
  }

  async latestSeq(): Promise<number> {
    const records = await this.store.readRecords()
    return records.reduce((latest, event) => Math.max(latest, event.seq), 0)
  }

  async hasSeq(seq: number): Promise<boolean> {
    return (await this.store.readRecords()).some(event => event.seq === seq)
  }

  async repairSeqFromEvents(): Promise<void> {
    await this.seq.repairSeqFromEvents(await this.latestSeq())
  }

  private async createDurableEventInTransaction(input: DurableEventInput): Promise<EventEnvelope> {
    return createEventEnvelope({
      eventId: input.eventId ?? createProtocolId('evt'),
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
      seq: await this.seq.nextInTransaction(),
      payload: redactDurablePayload(input.payload),
    })
  }

  private importEvent(event: EventEnvelope): EventEnvelope {
    validateEventEnvelope(event)
    return {
      ...event,
      payload: markImportedPayload(redactDurablePayload(event.payload)),
    }
  }
}

export function validateEventForStore(event: EventEnvelope): void {
  validateEventEnvelope(event)
  if (isRunEvent(event.eventType) && !event.runId) {
    throw new Error(`Run event ${event.eventType} requires runId`)
  }
  JSON.stringify(event.payload)
}

function isRunEvent(eventType: string): boolean {
  return eventType.startsWith('run_') || eventType === 'kernel_persistence_failed'
}

function markImportedPayload(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      ...payload,
      importMode: true,
    }
  }
  return {
    value: payload,
    importMode: true,
  }
}
