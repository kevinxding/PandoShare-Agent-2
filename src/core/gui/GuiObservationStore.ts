import { JsonlStore, ProcessFileLock, type CorruptJsonlRecord } from '../store/index.js'
import type { GuiObservation, GuiRuntimeActionRecord } from './GuiTypes.js'

export type GuiStoreReadResult<T> = {
  records: T[]
  warnings: string[]
}

export class GuiObservationStore {
  private readonly actionLock: ProcessFileLock
  private readonly observationLock: ProcessFileLock

  constructor(
    private readonly actionStore: JsonlStore<GuiRuntimeActionRecord>,
    private readonly observationStore: JsonlStore<GuiObservation> = actionStore as unknown as JsonlStore<GuiObservation>,
  ) {
    this.actionLock = new ProcessFileLock(actionStore.path)
    this.observationLock = new ProcessFileLock(observationStore.path)
  }

  record(action: GuiRuntimeActionRecord): Promise<void> {
    return this.actionStore.appendLocked(action, this.actionLock, { reason: 'gui action record append' })
  }

  recordObservation(observation: GuiObservation): Promise<void> {
    return this.observationStore.appendLocked(observation, this.observationLock, { reason: 'gui observation append' })
  }

  async readAll(): Promise<GuiRuntimeActionRecord[]> {
    return this.actionStore.readRecords()
  }

  async readActionsWithWarnings(): Promise<GuiStoreReadResult<GuiRuntimeActionRecord>> {
    const result = await this.actionStore.readWithCorruption()
    return { records: result.records, warnings: corruptWarnings('gui action', result.corruptRecords) }
  }

  async readObservationsWithWarnings(): Promise<GuiStoreReadResult<GuiObservation>> {
    const result = await this.observationStore.readWithCorruption()
    return { records: result.records, warnings: corruptWarnings('gui observation', result.corruptRecords) }
  }

  async readByActionId(guiActionId: string): Promise<GuiRuntimeActionRecord | undefined> {
    return (await this.actionStore.readRecords()).reverse().find(record => record.identity.guiActionId === guiActionId)
  }

  async readLatestObservation(): Promise<GuiObservation | undefined> {
    return (await this.observationStore.readRecords()).sort((left, right) => right.createdAtMs - left.createdAtMs)[0]
  }

  async listRecentActions(limit = 20): Promise<GuiRuntimeActionRecord[]> {
    return (await this.actionStore.readRecords())
      .sort((left, right) => right.createdAtMs - left.createdAtMs)
      .slice(0, limit)
  }
}

function corruptWarnings(kind: string, records: readonly CorruptJsonlRecord[]): string[] {
  return records.map(record => `${kind} jsonl corruption line ${record.lineNumber}: ${record.message}`)
}
