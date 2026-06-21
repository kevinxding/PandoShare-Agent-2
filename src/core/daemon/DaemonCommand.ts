import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { DaemonPidFile } from './DaemonPidFile.js'
import type { DaemonMarkerKind, DaemonMarkerRecord, DaemonRuntimeIdentity } from './DaemonTypes.js'

export class DaemonCommand {
  private readonly pidFile: DaemonPidFile

  constructor(input: DaemonRuntimeIdentity) {
    this.pidFile = new DaemonPidFile(input)
  }

  async requestStop(reason = 'stop requested', message?: string): Promise<DaemonMarkerRecord> {
    const pid = await this.pidFile.read()
    return this.writeMarker('stop', reason, message, pid?.pid)
  }

  async readStopMarker(): Promise<DaemonMarkerRecord | undefined> {
    return this.readMarker(this.pidFile.paths.stopMarkerPath)
  }

  async clearStopMarker(): Promise<void> {
    await rm(this.pidFile.paths.stopMarkerPath, { force: true })
  }

  async writeCrashMarker(reason: string, message?: string, pid?: number): Promise<DaemonMarkerRecord> {
    return this.writeMarker('crash', reason, message, pid)
  }

  async readCrashMarker(): Promise<DaemonMarkerRecord | undefined> {
    return this.readMarker(this.pidFile.paths.crashMarkerPath)
  }

  async clearCrashMarker(): Promise<void> {
    await rm(this.pidFile.paths.crashMarkerPath, { force: true })
  }

  async clearMarkers(): Promise<void> {
    await this.clearStopMarker()
    await this.clearCrashMarker()
  }

  private async writeMarker(kind: DaemonMarkerKind, reason: string, message?: string, pid?: number): Promise<DaemonMarkerRecord> {
    const paths = this.pidFile.paths
    const record: DaemonMarkerRecord = {
      schemaVersion: 1,
      kind,
      daemonId: paths.daemonId,
      workspaceId: paths.workspaceId,
      runtimeId: paths.runtimeId,
      pid,
      reason,
      createdAtMs: Date.now(),
      message,
    }
    await writeJson(kind === 'stop' ? paths.stopMarkerPath : paths.crashMarkerPath, record)
    return record
  }

  private async readMarker(path: string): Promise<DaemonMarkerRecord | undefined> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as DaemonMarkerRecord
    } catch {
      return undefined
    }
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
