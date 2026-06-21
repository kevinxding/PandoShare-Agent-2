import { DaemonCommand } from './DaemonCommand.js'
import { DaemonHealth, type DaemonHealthInput } from './DaemonHealth.js'
import { DaemonPidFile } from './DaemonPidFile.js'
import type { DaemonWatchdogReport } from './DaemonTypes.js'

export type WatchdogCheckInput = {
  staleAfterMs?: number
  nowMs?: number
  markStale?: boolean
}

export class Watchdog {
  readonly health: DaemonHealth
  readonly pidFile: DaemonPidFile
  readonly command: DaemonCommand

  constructor(private readonly input: DaemonHealthInput) {
    this.health = new DaemonHealth(input)
    this.pidFile = new DaemonPidFile(input)
    this.command = new DaemonCommand(input)
  }

  async check(input: WatchdogCheckInput = {}): Promise<DaemonWatchdogReport> {
    const report = await this.health.report(input)
    let markedStale = false
    if (input.markStale !== false && report.status === 'stale') {
      const pid = report.pid?.record?.pid
      await this.health.writeHeartbeat({
        status: 'stale',
        pid,
        message: report.message,
        metadata: {
          watchdog: true,
          staleAfterMs: report.staleAfterMs,
          heartbeatAgeMs: report.heartbeatAgeMs,
        },
      })
      await this.command.writeCrashMarker('stale_heartbeat', report.message, pid)
      await this.pidFile.updateStatus('crashed', report.message)
      markedStale = true
    }
    return {
      ...report,
      markedStale,
    }
  }
}
