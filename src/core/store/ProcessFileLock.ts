import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type ProcessFileLockOptions = {
  timeoutMs?: number
  staleMs?: number
  retryDelayMs?: number
  reason?: string
}

export type ProcessFileLockHandle = {
  lockPath: string
  lockToken: string
  staleTakeover: boolean
  release(): Promise<void>
}

export type ProcessFileLockRecord = {
  lockToken: string
  pid: number
  createdAtMs: number
  hostname: string
  reason?: string
}

export class ProcessFileLock {
  constructor(readonly targetPath: string) {}

  get lockPath(): string {
    return `${this.targetPath}.lock`
  }

  async acquire(options: ProcessFileLockOptions = {}): Promise<ProcessFileLockHandle> {
    const timeoutMs = options.timeoutMs ?? 10_000
    const staleMs = options.staleMs ?? 30_000
    const retryDelayMs = options.retryDelayMs ?? 25
    const startedAtMs = Date.now()
    const record: ProcessFileLockRecord = {
      lockToken: `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
      pid: currentPid(),
      createdAtMs: Date.now(),
      hostname: 'unknown',
      reason: options.reason,
    }
    let staleTakeover = false

    while (true) {
      try {
        await mkdir(dirname(this.lockPath), { recursive: true })
        await mkdir(this.lockPath)
        await writeFile(this.recordPath(), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
        return this.handle(record.lockToken, staleTakeover)
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
        if (await this.tryTakeoverStaleLock(staleMs)) {
          staleTakeover = true
          continue
        }
        if (Date.now() - startedAtMs >= timeoutMs) {
          throw new Error(`Timed out acquiring process file lock: ${this.lockPath}`)
        }
        await delay(retryDelayMs)
      }
    }
  }

  async withLock<T>(options: ProcessFileLockOptions, run: () => Promise<T>): Promise<T> {
    const handle = await this.acquire(options)
    try {
      return await run()
    } finally {
      await handle.release()
    }
  }

  private handle(lockToken: string, staleTakeover: boolean): ProcessFileLockHandle {
    return {
      lockPath: this.lockPath,
      lockToken,
      staleTakeover,
      release: async () => {
        const current = await this.readLockRecord().catch(() => undefined)
        if (!current || current.lockToken !== lockToken) return
        await rm(this.lockPath, { recursive: true, force: true })
      },
    }
  }

  private async tryTakeoverStaleLock(staleMs: number): Promise<boolean> {
    if (!(await exists(this.lockPath))) return true
    const current = await this.readLockRecord().catch(() => undefined)
    const createdAtMs = current?.createdAtMs ?? Date.now()
    if (Date.now() - createdAtMs < staleMs) return false
    await writeFile(
      `${this.lockPath}.stale-${Date.now()}`,
      `${JSON.stringify({ staleTakenOverAtMs: Date.now(), previous: current }, null, 2)}\n`,
      'utf8',
    )
    await rm(this.lockPath, { recursive: true, force: true })
    return true
  }

  private async readLockRecord(): Promise<ProcessFileLockRecord> {
    return JSON.parse(await readFile(this.recordPath(), 'utf8')) as ProcessFileLockRecord
  }

  private recordPath(): string {
    return join(this.lockPath, 'owner.json')
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

function currentPid(): number {
  return (globalThis as { process?: { pid?: number } }).process?.pid ?? 0
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
