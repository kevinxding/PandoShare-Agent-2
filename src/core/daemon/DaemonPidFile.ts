import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { RuntimePaths, safeId } from '../store/index.js'
import type { DaemonPaths, DaemonPidInspection, DaemonPidRecord, DaemonRuntimeIdentity, DaemonStatus } from './DaemonTypes.js'

export type DaemonPidWriteInput = {
  pid?: number
  status?: DaemonStatus
  command?: string
  message?: string
  startedAtMs?: number
}

export class DaemonPidFile {
  readonly paths: DaemonPaths

  constructor(input: DaemonRuntimeIdentity) {
    this.paths = createDaemonPaths(input)
  }

  async write(input: DaemonPidWriteInput = {}): Promise<DaemonPidRecord> {
    const now = Date.now()
    const startedAtMs = input.startedAtMs ?? now
    const record: DaemonPidRecord = {
      schemaVersion: 1,
      daemonId: this.paths.daemonId,
      workspaceId: this.paths.workspaceId,
      runtimeId: this.paths.runtimeId,
      pid: input.pid ?? currentPid(),
      status: input.status ?? 'running',
      startedAtMs,
      updatedAtMs: now,
      cwd: runtimeCwd(this.paths.workspaceRoot),
      pidPath: this.paths.pidPath,
      stopMarkerPath: this.paths.stopMarkerPath,
      crashMarkerPath: this.paths.crashMarkerPath,
      heartbeatWorkerId: this.paths.runtimeId,
      command: input.command,
      message: input.message,
    }
    await writeJson(this.paths.pidPath, record)
    return record
  }

  async read(): Promise<DaemonPidRecord | undefined> {
    try {
      return JSON.parse(await readFile(this.paths.pidPath, 'utf8')) as DaemonPidRecord
    } catch {
      return undefined
    }
  }

  async updateStatus(status: DaemonStatus, message?: string): Promise<DaemonPidRecord | undefined> {
    const current = await this.read()
    if (!current) return undefined
    const next: DaemonPidRecord = {
      ...current,
      status,
      updatedAtMs: Date.now(),
      message,
    }
    await writeJson(this.paths.pidPath, next)
    return next
  }

  async remove(): Promise<void> {
    await rm(this.paths.pidPath, { force: true })
  }

  async inspect(input: { isProcessAlive?: (pid: number) => boolean } = {}): Promise<DaemonPidInspection> {
    const record = await this.read()
    if (!record) {
      return {
        status: 'missing',
        stale: false,
        message: 'No daemon PID file exists.',
      }
    }
    if (record.status === 'stopped') {
      return {
        status: 'stale',
        stale: true,
        record,
        message: `Daemon PID file is stopped: pid=${record.pid}.`,
      }
    }
    if (record.status === 'crashed') {
      return {
        status: 'stale',
        stale: true,
        record,
        message: `Daemon PID file is crashed: pid=${record.pid}.`,
      }
    }
    const alive = input.isProcessAlive?.(record.pid) ?? isProcessAlive(record.pid)
    if (!alive) {
      return {
        status: 'stale',
        stale: true,
        record,
        message: `Daemon PID is not alive: pid=${record.pid}.`,
      }
    }
    return {
      status: 'active',
      stale: false,
      record,
      message: `Daemon PID is active: pid=${record.pid}.`,
    }
  }
}

export function createDaemonPaths(input: DaemonRuntimeIdentity): DaemonPaths {
  const workspaceRoot = input.workspaceRoot
  const workspaceId = input.workspaceId ?? 'default'
  const daemonId = input.daemonId ?? input.runtimeId ?? 'daemon'
  const runtimeId = input.runtimeId ?? daemonId
  const runtimePaths = new RuntimePaths({ workspaceRoot, workspaceId })
  const prefix = `daemon-${safeId(workspaceId)}-${safeId(runtimeId)}`
  return {
    workspaceRoot: runtimePaths.workspaceRoot,
    workspaceId,
    daemonId: safeId(daemonId),
    runtimeId: safeId(runtimeId),
    pidPath: runtimePaths.statePath(`${prefix}-pid`),
    stopMarkerPath: runtimePaths.statePath(`${prefix}-stop`),
    crashMarkerPath: runtimePaths.statePath(`${prefix}-crash`),
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  if (pid === currentPid()) return true
  const runtime = globalThis as unknown as { process?: { kill?: (pid: number, signal?: string | number) => boolean } }
  try {
    const result = runtime.process?.kill?.(pid, 0)
    return result !== false && result !== undefined
  } catch {
    return false
  }
}

function currentPid(): number {
  const runtime = globalThis as unknown as { process?: { pid?: number } }
  return runtime.process?.pid ?? 0
}

function runtimeCwd(fallback: string): string {
  const runtime = globalThis as unknown as { process?: { cwd?: () => string } }
  try {
    return runtime.process?.cwd?.() ?? fallback
  } catch {
    return fallback
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
