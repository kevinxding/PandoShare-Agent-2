import { spawn } from 'node:child_process'

import { DaemonProcess, type DaemonForegroundOptions } from './DaemonProcess.js'
import type { DaemonForegroundRunResult } from './DaemonTypes.js'
import type { DaemonHealthInput } from './DaemonHealth.js'

export type DaemonStartInput = DaemonForegroundOptions & {
  mode?: 'foreground' | 'background'
  explicitBackground?: boolean
  backgroundCommand?: string
  backgroundArgs?: readonly string[]
  backgroundEnv?: Record<string, string | undefined>
}

export type DaemonStartResult =
  | ({ mode: 'foreground' } & DaemonForegroundRunResult)
  | { mode: 'background'; pid?: number; command: string; args: readonly string[] }

export class DaemonSupervisor {
  readonly process: DaemonProcess

  constructor(private readonly input: DaemonHealthInput) {
    this.process = new DaemonProcess(input)
  }

  async start(input: DaemonStartInput = {}): Promise<DaemonStartResult> {
    if (input.mode === 'background') {
      if (!input.explicitBackground) {
        throw new Error('Background daemon spawn requires explicitBackground=true.')
      }
      const command = input.backgroundCommand
      if (!command) throw new Error('Background daemon spawn requires backgroundCommand.')
      const args = input.backgroundArgs ?? []
      const child = spawn(command, args, {
        cwd: this.input.workspaceRoot,
        env: input.backgroundEnv,
        windowsHide: true,
      })
      return {
        mode: 'background',
        pid: child.pid,
        command,
        args,
      }
    }

    const result = await this.process.runForeground(input)
    return {
      mode: 'foreground',
      ...result,
    }
  }
}
