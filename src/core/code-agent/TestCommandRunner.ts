import { spawn } from 'node:child_process'
import type { CodeTaskVerifierCommand } from './CodeTaskFixture.js'

export type TestCommandResult = {
  command: string
  args: string[]
  cwd: string
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  stdout: string
  stderr: string
  durationMs: number
}

export class TestCommandRunner {
  async run(command: CodeTaskVerifierCommand, cwd: string): Promise<TestCommandResult> {
    return runCommand(command.command, command.args ?? [], cwd, command.timeoutMs ?? 5000)
  }

  async runAll(commands: readonly CodeTaskVerifierCommand[], cwd: string): Promise<TestCommandResult[]> {
    const results: TestCommandResult[] = []
    for (const command of commands) results.push(await this.run(command, cwd))
    return results
  }
}

function runCommand(command: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<TestCommandResult> {
  const started = Date.now()
  return new Promise(resolveRun => {
    const child = spawn(command, [...args], { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.on('error', error => {
      clearTimeout(timeout)
      resolveRun({ command, args: [...args], cwd, exitCode: 1, signal: null, timedOut, stdout, stderr: stderr + error.message, durationMs: Date.now() - started })
    })
    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout)
      resolveRun({ command, args: [...args], cwd, exitCode, signal, timedOut, stdout, stderr, durationMs: Date.now() - started })
    })
  })
}
