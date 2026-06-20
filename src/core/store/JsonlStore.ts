import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProcessFileLock, ProcessFileLockOptions } from './ProcessFileLock.js'

export type CorruptJsonlRecord = {
  lineNumber: number
  linePreview: string
  message: string
}

export type JsonlReadResult<T> = {
  records: T[]
  corruptRecords: CorruptJsonlRecord[]
}

export class JsonlStore<TRecord = unknown> {
  constructor(readonly path: string) {}

  async append(record: TRecord): Promise<void> {
    await this.appendLine(record)
  }

  async appendLocked(record: TRecord, lock: ProcessFileLock, options: ProcessFileLockOptions = {}): Promise<void> {
    await lock.withLock({ reason: `jsonl append ${this.path}`, ...options }, async () => {
      await this.appendLine(record)
    })
  }

  async appendManyLocked(records: readonly TRecord[], lock: ProcessFileLock, options: ProcessFileLockOptions = {}): Promise<void> {
    await lock.withLock({ reason: `jsonl append many ${this.path}`, ...options }, async () => {
      for (const record of records) {
        await this.appendLine(record)
      }
    })
  }

  async read(): Promise<JsonlReadResult<TRecord>> {
    return this.readWithCorruption()
  }

  async readWithCorruption(): Promise<JsonlReadResult<TRecord>> {
    if (!(await exists(this.path))) return { records: [], corruptRecords: [] }
    const text = await readFile(this.path, 'utf8')
    const records: TRecord[] = []
    const corruptRecords: CorruptJsonlRecord[] = []
    const lines = text.split(/\r?\n/)
    lines.forEach((line, index) => {
      if (!line.trim()) return
      try {
        records.push(JSON.parse(line) as TRecord)
      } catch (error) {
        corruptRecords.push({
          lineNumber: index + 1,
          linePreview: line.slice(0, 500),
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })
    return { records, corruptRecords }
  }

  async readRecords(): Promise<TRecord[]> {
    return (await this.read()).records
  }

  private async appendLine(record: TRecord): Promise<void> {
    const line = JSON.stringify(record)
    if (typeof line !== 'string') throw new Error('JSONL record is not serializable')
    await mkdir(dirname(this.path), { recursive: true })
    await appendFile(this.path, `${line}\n`, 'utf8')
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
