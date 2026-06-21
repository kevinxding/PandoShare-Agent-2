import { DaemonCommand } from './DaemonCommand.js'
import { DaemonHealth, type DaemonHealthInput } from './DaemonHealth.js'
import { DaemonPidFile } from './DaemonPidFile.js'
import type { DaemonForegroundRunResult, DaemonRunSignal } from './DaemonTypes.js'

export type DaemonForegroundOptions = {
  command?: string
  message?: string
  staleAfterMs?: number
  removePidOnExit?: boolean
  run?: (signal: DaemonRunSignal) => Promise<void>
}

export class DaemonProcess {
  readonly pidFile: DaemonPidFile
  readonly command: DaemonCommand
  readonly health: DaemonHealth

  constructor(private readonly input: DaemonHealthInput) {
    this.pidFile = new DaemonPidFile(input)
    this.command = new DaemonCommand(input)
    this.health = new DaemonHealth(input)
  }

  async runForeground(options: DaemonForegroundOptions = {}): Promise<DaemonForegroundRunResult> {
    await this.command.clearMarkers()
    const pid = await this.pidFile.write({
      status: 'starting',
      command: options.command,
      message: options.message ?? 'Daemon foreground run starting.',
    })
    await this.health.writeHeartbeat({ status: 'starting', pid: pid.pid, message: options.message ?? 'Daemon foreground run starting.' })
    await this.pidFile.updateStatus('running', 'Daemon foreground run is active.')
    await this.health.writeHeartbeat({ status: 'running', pid: pid.pid, message: 'Daemon foreground run is active.' })

    let stoppedBySignal = false
    try {
      const stopMarker = await this.command.readStopMarker()
      const signal: DaemonRunSignal = {
        stopRequested: Boolean(stopMarker),
        stopReason: stopMarker?.reason,
      }
      stoppedBySignal = signal.stopRequested
      await options.run?.(signal)
      const finalStopMarker = await this.command.readStopMarker()
      stoppedBySignal = stoppedBySignal || Boolean(finalStopMarker)
      await this.pidFile.updateStatus('stopped', finalStopMarker?.reason ?? 'Daemon foreground run stopped.')
      await this.health.writeHeartbeat({ status: 'stopped', pid: pid.pid, message: finalStopMarker?.reason ?? 'Daemon foreground run stopped.' })
      const health = await this.health.report({ staleAfterMs: options.staleAfterMs })
      if (options.removePidOnExit) await this.pidFile.remove()
      return {
        pid,
        health,
        status: 'stopped',
        stoppedBySignal,
      }
    } catch (error) {
      const message = errorMessage(error)
      await this.command.writeCrashMarker('foreground_run_failed', message, pid.pid)
      await this.pidFile.updateStatus('crashed', message)
      await this.health.writeHeartbeat({ status: 'failed', pid: pid.pid, message })
      throw error
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
