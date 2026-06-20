import { JsonlStore, ProcessFileLock, RuntimePaths } from '../store/index.js'
import type { RunState, RunStatus } from '../agent/RunStateMachine.js'

export type RunLedgerEntry = {
  runId: string
  workspaceId?: string
  threadId?: string
  goalId?: string
  loopId?: string
  commandId: string
  commandType: string
  source: string
  status: RunStatus
  createdAtMs: number
  updatedAtMs: number
  error?: string
}

export class RunLedgerStore {
  private readonly lock: ProcessFileLock

  constructor(private readonly store: JsonlStore<RunLedgerEntry>) {
    this.lock = new ProcessFileLock(store.path)
  }

  static fromRuntimePaths(paths: RuntimePaths): RunLedgerStore {
    return new RunLedgerStore(new JsonlStore(paths.queuePath('agent-run-ledger')))
  }

  async append(state: RunState | RunLedgerEntry): Promise<RunLedgerEntry> {
    const entry: RunLedgerEntry = 'workspaceId' in state && 'lastError' in state
      ? runStateToLedgerEntry(state)
      : normalizeLedgerEntry(state as RunLedgerEntry)
    await this.store.appendLocked(entry, this.lock, { reason: 'run ledger append' })
    return entry
  }

  async readRun(runId: string): Promise<RunLedgerEntry | undefined> {
    return latestByRun(await this.store.readRecords()).get(runId)
  }

  async readActiveRuns(): Promise<RunLedgerEntry[]> {
    return [...latestByRun(await this.store.readRecords()).values()]
      .filter(entry => isActiveStatus(entry.status))
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
  }

  async readRecentRuns(limit = 20): Promise<RunLedgerEntry[]> {
    return [...latestByRun(await this.store.readRecords()).values()]
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
      .slice(0, limit)
  }
}

function runStateToLedgerEntry(state: RunState): RunLedgerEntry {
  return {
    runId: state.runId,
    workspaceId: state.workspaceId,
    threadId: state.threadId,
    goalId: state.goalId,
    loopId: state.loopId,
    commandId: state.commandId,
    commandType: state.commandType,
    source: state.source,
    status: state.status,
    createdAtMs: state.createdAtMs,
    updatedAtMs: state.updatedAtMs,
    error: state.lastError,
  }
}

function normalizeLedgerEntry(entry: RunLedgerEntry): RunLedgerEntry {
  return { ...entry }
}

function latestByRun(entries: readonly RunLedgerEntry[]): Map<string, RunLedgerEntry> {
  const latest = new Map<string, RunLedgerEntry>()
  for (const entry of entries) {
    const existing = latest.get(entry.runId)
    if (!existing || entry.updatedAtMs >= existing.updatedAtMs) {
      latest.set(entry.runId, entry)
    }
  }
  return latest
}

function isActiveStatus(status: RunStatus): boolean {
  return status === 'created' || status === 'started' || status === 'running' || status === 'waiting_approval'
}
